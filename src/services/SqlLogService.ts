// services/SqlLogService.ts

import { vscode } from "@exportLibs";
import { convertMybatisLog } from "@exportModels";

const BREAK_KEYWORD_PATTERN = /\s+(FROM|WHERE|LEFT JOIN|RIGHT JOIN|INNER JOIN|OUTER JOIN|JOIN|GROUP BY|ORDER BY|HAVING|LIMIT|VALUES|SET|UNION)\b/gi;

export const SqlLogService = () => {
  // 1-1. MyBatis 로그 -> SQL 변환 (Preparing/Parameters 파싱은 순수 모델에 위임)
  const convertLog = (logText: string): string | null => convertMybatisLog(logText);

  // 1-2. 주요 절 앞 개행 정리
  const formatSql = (sql: string): string => sql.replace(BREAK_KEYWORD_PATTERN, `\n$1`).trim();

  // 1-3. 변환 결과를 새 SQL 문서로 열기
  const openAsDoc = async (sql: string): Promise<void> => {
    const doc = await vscode.workspace.openTextDocument({ "language": `sql`, "content": sql });
    await vscode.window.showTextDocument(doc, { "preview": false });
  };

  // 99. return -----------------------------------------------------------------------------
  return { convertLog, formatSql, openAsDoc };
};
