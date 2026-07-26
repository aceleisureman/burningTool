// 编译与烧录公共入口：保持历史 require('./flash/flasher') 调用兼容。
module.exports = {
  ...require('./probe'),
  ...require('./project'),
  ...require('./build'),
  ...require('./runner')
};
