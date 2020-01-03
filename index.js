'use strict';

const assert = require('assert');
const Base = require('sdk-base');
const crypto = require('crypto');

class BaseCache extends Base {

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
  }

  toLog(msg, key) {
    this.log && this.log.info(`Executed (cache): key/${key}`, JSON.stringify(msg));
  }

  async run(method, tables, args) {
    const keyParams = {
      method,
      params: args,
    };
    const key = this.key(keyParams, tables);
    const cache = await this.cacheClient.get(key);
    if (cache) {
      this.toLog(keyParams, key);
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
      return self.cacheClient.sadd(`${self.namespace}:${self.mappingPrefix}:${t}`, key);
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

module.exports = BaseCache;