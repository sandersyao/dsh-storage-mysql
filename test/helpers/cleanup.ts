import type { Connection } from "mysql2/promise";

/**
 * 清理某测试库中本插件基名（%storage_%）的表，返回删除的表数。
 * 仅删 storage 基名表，避免误删与他包共库的其他测试表。
 * @param conn - root 连接。
 * @param database - 目标库名。
 * @returns 删除的表数。
 */
export async function cleanStorageTables(conn: Connection, database: string): Promise<number> {
  await conn.query("SET FOREIGN_KEY_CHECKS = 0");
  const [tables] = await conn.query<Array<{ TABLE_NAME: string }>>(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME LIKE '%storage_%'`,
    [database],
  );
  let count = 0;
  for (const table of tables) {
    await conn.query(`DROP TABLE IF EXISTS \`${database}\`.\`${table.TABLE_NAME}\``);
    count += 1;
  }
  await conn.query("SET FOREIGN_KEY_CHECKS = 1");
  return count;
}
