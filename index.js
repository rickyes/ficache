'use strict';

const assert = require('assert');
const Base = require('sdk-base');
const crypto = require('crypto');
const NOT_CACHE = Symbol.for('ficache#notCache');

const isNullOrUndefined = value => value === null || value === undefined;

const FindMethods = ['findOne', 'findAll', 'count', 'find', 'findAndCountAll'];
const UpdateMethods = ['create', 'update', 'destroy'];

class BaseCache extends Base {

  /**
   * @param {Object} options 
   * @param {import('sequelize').sequelize} options.dbClient
   * @param {import('ioredis').Redis} options.cacheClient
   * @param {import('sequelize').ModelType} options.model
   * @param {String} options.namespace? cache namespace
   * @param {String} options.mappingPrefix? cache table mapping prefix
   * @param {String} options.dataPrefix? cache prefix
   * @param {Number} options.ttl? cache data key ttl (second)
   * @param {import('log')} options.log? exec log
   * @param {Number} options.batchKeyCount? batch del key count
   * @param {Boolean} options.readCache? enable readCache
   * @param {Boolean} options.updateCache? enable updateCache
   */
  constructor(options) {
    super();
    assert(options.dbClient, 'Options dbCLient is Required');
    assert(options.cacheClient, 'Options cacheClient is Required');
    assert(options.model, 'Options model is Required');
    this.options = options;
    this.namespace = options.namespace || 'sequelize_base_cache';
    this.mappingPrefix = options.mappingPrefix || 'cache_keymap';
    this.dataPrefix = options.dataPrefix || 'cache';
    this.ttl = options.ttl || 24 * 3600;
    this.dbClient = options.dbClient;
    this.cacheClient = options.cacheClient;
    this.model = options.model;
    this.log = options.logger;
    this.batchKeyCount = options.batchKeyCount || 1000;
    this.mapKeyPrefix = `${this.namespace}:${this.mappingPrefix}`;
    this.readCache = isNullOrUndefined(options.readCache) ? true : options.readCache;
    this.updateCache = isNullOrUndefined(options.updateCache) ? true : options.updateCache;
  }

  getFindMethods() {
    return FindMethods;
  }

  getUpdateMethods() {
    return UpdateMethods;
  }

  toExecLog(msg, key) {
    this.log && this.log.info(`Executed (cache): key/${key}`, JSON.stringify(msg));
  }

  toDelLog(mapKey) {
    this.log && this.log.info(`Executed (delCache): mapKey/${mapKey}`);
  }

  toLog(level, ...msg) {
    this.log && this.log[level](...msg);
  }

  /**
   * 判断是否读取缓存
   * 当 options.readCache === false 时，where[NOT_CACHE] 默认为 true
   * 当 options.readCache === true 时，where[NOT_CACHE] 默认为 false
   * 
   * 1、options.readCache === true and where[NOT_CACHE]:true  =>  return false
   * 2、options.readCache === true and where[NOT_CACHE]:false  =>  return true
   * 3、options.readCache === false and where[NOT_CACHE]:false  =>  return true
   * 4、options.readCache === false and where[NOT_CACHE]:true  =>  return false
   * @param {Object} options db 查询条件 
   */
  isReadCache(options) {
    if (!options && !options.where) {
      return false;
    }

    const where = options.where;

    const notCacheDefault = !this.readCache;
    const notCache = isNullOrUndefined(where[NOT_CACHE]) ? notCacheDefault : where[NOT_CACHE];

    if (notCache) {
      return false;
    }
    return true;
  }

  /**
   * 执行缓存操作
   * @param {String} method model method
   * @param {Array<String>} tables relevance tables name
   * @param  {...any} args query params
   */
  async run(method, tables, ...args) {
    if (!this.isReadCache(args[0])) {
      return this.runFromDatabase(method, args);
    }
    const keyParams = {
      method,
      params: args,
    };
    const key = this.key(keyParams, tables);
    const cache = await this.cacheClient.get(key);
    if (cache) {
      this.toExecLog(keyParams, key);
      return JSON.parse(cache);
    }
    const data = await this.runFromDatabase(method, args);

    await Promise.all([
      this.setCache(key, data),
      this.setCacheMap(key, tables),
    ]);

    return data;
  }

  async setCacheMap(key, tables) {
    const self = this;
    return Promise.all(tables.map(t => {
      return self.cacheClient.sadd(`${self.mapKeyPrefix}:${t}`, key);
    }));
  }

  async setCache(key, data) {
    return this.cacheClient.setex(key, this.ttl, JSON.stringify(data));
  }

  async runFromDatabase(method, args) {
    const runDbMethod = this.model[method];
    assert(runDbMethod, `dbModel not support '${method}' method`);
    // TODO catch error
    const results = await runDbMethod.apply(this.model, args);
    let res = null;
    if (!results) {
      res = results;
    } else if (Array.isArray(results)) {
      res = results;
    } else if (results.toString() === '[object SequelizeInstance]') {
      res = results.get({ plain: true });
    } else {
      res = results;
    }
    return res;
  }


  /**
   * 批量删除缓存
   * @param {Array<String>} tables tables name
   */
  batchClearCache(tables = []) {
    const self = this;
    tables.forEach(async t => {
      const mapKey = `${self.mapKeyPrefix}:${t}`;
      self.toDelLog(mapKey);
      // 子进程无法传递 cache 可用句柄, 暂时在当前进程实现删除
      let cursor = null;
      while (cursor !== 0) {
        const result = await self.cacheClient.sscan(mapKey, cursor || 0, 'match', '*', 'count', self.batchKeyCount);
        cursor = Number(result[0]);
        result[1].forEach(k => {
          self.clearCache(k);
          self.cacheClient.srem(mapKey, k);
        });
      }
    });
  }

  clearCache(key) {
    return this.cacheClient.del(key);
  }


  /**
   * 生成 key
   * @param {Object} options
   * @param {String} options.method? model method
   * @param {String} options.params model query params
   * @param {String} options.sql? raw query sql
   * @param {String[]} tables tables name
   * @param {String} prefix 
   */
  key(options, tables, prefix = this.dataPrefix) {
    let hash = null;
    if (options.sql) {
      return;
    }
    hash = crypto.createHash('sha1')
      .update(JSON.stringify({
        method: options.method,
        params: options.params,
      }))
      .digest('hex');
    return [this.namespace, prefix, tables.join('_'), hash].join(':');
  }

}

BaseCache.NOT_CACHE = NOT_CACHE;

module.exports = BaseCache;