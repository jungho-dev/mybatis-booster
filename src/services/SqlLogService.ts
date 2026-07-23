// services/SqlLogService.ts

import { vscode } from "@exportLibs";
import { logger } from "@exportScripts";

const PREPARING = `Preparing:`;
const PARAMETERS = `Parameters:`;
const NUMERIC_TYPES = new Set([`Integer`, `Long`, `Short`, `Byte`, `Double`, `Float`, `BigDecimal`, `BigInteger`, `Boolean`]);
const BREAK_KEYWORD_PATTERN = /\s+(FROM|WHERE|LEFT JOIN|RIGHT JOIN|INNER JOIN|OUTER JOIN|JOIN|GROUP BY|ORDER BY|HAVING|LIMIT|VALUES|SET|UNION)\b/gi;

export const SqlLogService = () => {
  // 1-1. 파라미터 토큰 -> SQL 리터럴 변환 (로그의 "value(Type)" 형식 처리)
  const toLiteral = (token: string): string => {
    const trimmed = token.trim();
    if (!trimmed || trimmed === `null`) {
      return `NULL`;
    }
    const typeStart = trimmed.lastIndexOf(`(`);
    const hasType = typeStart > -1 && trimmed.endsWith(`)`);
    const value = hasType ? trimmed.slice(0, typeStart).trim() : trimmed;
    const type = hasType ? trimmed.slice(typeStart + 1, -1).trim() : ``;
    return NUMERIC_TYPES.has(type) ? value : `'${value.replaceAll(`'`, `''`)}'`;
  };

  // 1-2. MyBatis 로그 -> SQL 변환 (Preparing/Parameters 라인 파싱 후 ? 순차 치환)
  const convertLog = (logText: string): string | null => {
    const lines = logText.split(/\r?\n/);
    const preparing = lines.find((line) => line.includes(PREPARING));
    if (!preparing) {
      logger(`debug`, `convertLog - no "${PREPARING}" line found`);
      return null;
    }
    let sql = preparing.slice(preparing.indexOf(PREPARING) + PREPARING.length).trim();
    const parameters = lines.find((line) => line.includes(PARAMETERS));
    if (parameters) {
      const raw = parameters.slice(parameters.indexOf(PARAMETERS) + PARAMETERS.length).trim();
      raw?.split(`,`).forEach((token) => {
        sql = sql.replace(`?`, toLiteral(token));
      });
    }
    return sql;
  };

  // 1-3. 주요 절 앞 개행 정리
  const formatSql = (sql: string): string => sql.replace(BREAK_KEYWORD_PATTERN, `\n$1`).trim();

  // 1-4. 변환 결과를 새 SQL 문서로 열기
  const openAsDoc = async (sql: string): Promise<void> => {
    const doc = await vscode.workspace.openTextDocument({ "language": `sql`, "content": sql });
    await vscode.window.showTextDocument(doc, { "preview": false });
  };

  // 99. return -----------------------------------------------------------------------------
  return { convertLog, formatSql, openAsDoc };
};
