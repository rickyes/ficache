# ficache

数据库二级缓存.

- 模型查询设置缓存
- 自动过期
- 数据更新及时删除缓存
- 多表查询设置缓存
- 执行日志

## 支持查询方法
- findOne
- findAll
- count
- find
- findAndCountAll

## 支持更新方法
- create
- update
- destroy

### 快速使用
> 建议搭配 [sequelize-base](https://www.npmjs.com/package/sequelize-base) 使用

#### 创建 model
``` js
const Cacher = require('ficache');
const Base = require('sequelize-base');
const Sequelize = require('sequelize');
const {INTEGER, STRING, CHAR} = DataTypes;
 
const pool = new Sequelize(Object.assign(config, {
  logging: (msg) => log.info(msg),
}));
 
const attributes = {
  userId: {type: INTEGER(11), primaryKey: true, autoIncrement: true, field: 'user_id'},
  account: {type: STRING(30), comment: 'accout', allowNull: false, unique: true, field: 'accout'},
  nickName: {type: STRING(30), comment: 'nickName', allowNull: false, field: 'nickname'},
  password: {type: STRING(32), comment: '密码', allowNull: false, field: 'password'},
  invalid: {type: CHAR(1), defaultValve: 'N', comment: '是否有效', field: 'invalid'},
};
 
const UserEntity = pool.define('User', attributes, {
  timestamps: true,
  freezeTableName: true,
  updatedAt: 'mtime',
  createdAt: 'ctime',
  tableName: 'bas_user',
  charset: 'utf8mb4',
  comment: '用户表',
});
 
class UserModel extends Base {
 
  constructor(opts) {
    super(opts);
  }
 
  static getInstance(opts = {
      entity: UserEntity,
      cacher: new Cacher({
        dbClient: pool,
        cacheClient: redis.client,
        model: UserEntity,
        logger: log,
      }),
    }) {
    if (!this.instance) {
      this.instance = new UserModel(opts);
    }
    return this.instance;
  }
 
}
 
module.exports = UserModel;
```

#### 查询缓存
```js
'use strict';

const userModel = require('../model/userModel');

exports.getUsers = async () => {
  return userModel.findAll();
};
```
第一次查询会从数据库中获取数据，并设置缓存，之后查询从缓存中获取

```sh
Executed (cache): key/sequelize_base_cache:cache:base_user:7afe7351e3372bfa3dbdbd63d4adeb2059ef2c88 {"method":"findAll","params":[{"where":{"invalid":"N"},"attributes":[]}]}
```

#### 删除缓存
```js
'use strict';

const userModel = require('../model/userModel');

exports.addUser = async (body) => {
  return userModel.create(body);
};
```
执行此操作会触发bas_user相关的key删除
```sh
Executed (delCache): mapKey/sequelize_base_cache:cache_keymap:bas_user
```
