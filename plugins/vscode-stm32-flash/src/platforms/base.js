'use strict';

/**
 * 平台处理器基类（接口契约）
 *
 * 每个平台实现以下方法：
 *   - detect(dir)                  → 检测工程特征，返回扩展的 projectInfo 字段
 *   - checkReadiness(cfg, dir)     → 返回 { compiler, flasher, readyForBuild, readyForFlash, ... }
 *   - build(ctx)                   → 返回 { ok, error? }
 *   - flash(ctx)                   → 返回 { ok, error? }
 *   - buildAndFlash(ctx)           → 返回 { ok, error? }
 *
 * ctx 结构：{ dir, cfg, output, statusBar, t }
 */
class PlatformBase {
  /** @returns {string} 平台 ID，如 'stm32cube' */
  get id() { throw new Error('Platform.id not implemented'); }

  /** @returns {string} 平台显示名称 */
  get label() { throw new Error('Platform.label not implemented'); }

  /**
   * 检测工程目录是否符合本平台特征
   * @param {string} dir
   * @returns {object} 附加字段合并到 projectInfo
   */
  // eslint-disable-next-line no-unused-vars
  detect(dir) { return {}; }

  /**
   * 检查编译器 + 烧录设备是否就绪
   * @param {object} cfg
   * @param {string} dir
   * @returns {Promise<{compiler, flasher, readyForBuild, readyForFlash, readyForBuildAndFlash, summary}>}
   */
  // eslint-disable-next-line no-unused-vars
  async checkReadiness(cfg, dir) {
    throw new Error(`Platform(${this.id}).checkReadiness not implemented`);
  }

  /**
   * 编译
   * @param {{ dir: string, cfg: object, output: object, statusBar: object, t: Function }} ctx
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  // eslint-disable-next-line no-unused-vars
  async build(ctx) {
    throw new Error(`Platform(${this.id}).build not implemented`);
  }

  /**
   * 烧录
   * @param {{ dir: string, cfg: object, output: object, statusBar: object, t: Function }} ctx
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  // eslint-disable-next-line no-unused-vars
  async flash(ctx) {
    throw new Error(`Platform(${this.id}).flash not implemented`);
  }

  /**
   * 一键编译烧录
   * @param {{ dir: string, cfg: object, output: object, statusBar: object, t: Function }} ctx
   * @returns {Promise<{ok: boolean, error?: string, buildOk?: boolean, flashOk?: boolean}>}
   */
  async buildAndFlash(ctx) {
    const buildResult = await this.build(ctx);
    if (!buildResult.ok) return { ok: false, buildOk: false, flashOk: false, error: buildResult.error };
    const flashResult = await this.flash(ctx);
    return { ok: flashResult.ok, buildOk: true, flashOk: flashResult.ok, error: flashResult.error };
  }

  /**
   * 检测探针（可选实现，不支持的平台返回 null）
   * @param {object} cfg
   * @returns {Promise<{ok: boolean, probes?: any[], error?: string}|null>}
   */
  // eslint-disable-next-line no-unused-vars
  async checkProbe(cfg) { return null; }

  /**
   * 读取芯片信息（可选实现）
   * @param {object} cfg
   * @returns {Promise<{ok: boolean, error?: string}|null>}
   */
  // eslint-disable-next-line no-unused-vars
  async readChipInfo(cfg) { return null; }
}

module.exports = { PlatformBase };
