/**
 * 包级 invariant 伴生插件，对齐 `dsh-credentials-mysql` / `dsh-session-
 * persistence-mysql` 惯例。本后端无可观察的进程内关系需持续校验；正确性
 * 依赖后端往返与崩溃测试（与 storage-json 一致）。
 * @module @sandersyao/dsh-storage-mysql/invariant
 */

/** 包名，用于注册。 */
const PACKAGE_NAME = "@sandersyao/dsh-storage-mysql";

/** Cordis 伴生插件名。 */
export const name = "storage-mysql-invariant";

/** 注册前必需的 invariants 服务。 */
export const inject = ["invariants"];

/**
 * 空安装体：本包无运行时不变式需注册。
 */
const install = () => {};

/**
 * 注册本包的 invariant 伴生。
 * @param ctx - 携带 invariants 服务的 Cordis 上下文。
 * @returns 注册成功后的 disposer。
 */
export function apply(ctx: { invariants: { register(name: string, fn: () => void): unknown } }) {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
}
