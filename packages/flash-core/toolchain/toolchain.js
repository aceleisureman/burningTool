// 工具链公共入口：保持历史 require('./toolchain/toolchain') 调用兼容。
module.exports = {
  ...require('./paths'),
  ...require('./status'),
  ...require('./installer'),
  ...require('./system-path')
};
