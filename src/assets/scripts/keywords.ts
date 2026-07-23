// assets/scripts/keywords.ts

// 1-1. SQL 키워드 목록 (XML mapper 하이라이트 대상)
const SQL_KEYWORDS = [
  `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `REPLACE`,
  `FROM`, `WHERE`, `AND`, `OR`, `NOT`, `NULL`, `IS`, `IN`, `EXISTS`, `BETWEEN`, `LIKE`, `ESCAPE`,
  `JOIN`, `INNER`, `LEFT`, `RIGHT`, `FULL`, `OUTER`, `CROSS`, `ON`, `USING`,
  `AS`, `ORDER`, `BY`, `GROUP`, `HAVING`, `LIMIT`, `OFFSET`, `UNION`, `ALL`, `DISTINCT`,
  `VALUES`, `INTO`, `SET`, `DUAL`, `DUPLICATE`, `IGNORE`,
  `CASE`, `WHEN`, `THEN`, `ELSE`, `END`, `IF`, `IFNULL`, `NULLIF`, `COALESCE`, `CAST`, `CONVERT`,
  `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, `ROUND`, `FLOOR`, `CEIL`, `CEILING`, `ABS`, `MOD`, `POWER`, `SQRT`,
  `CONCAT`, `CONCAT_WS`, `GROUP_CONCAT`, `SUBSTRING`, `SUBSTR`, `TRIM`, `LTRIM`, `RTRIM`,
  `UPPER`, `LOWER`, `LENGTH`, `CHAR_LENGTH`, `INSTR`, `LPAD`, `RPAD`,
  `NOW`, `SYSDATE`, `CURDATE`, `CURTIME`, `DATE`, `TIME`, `YEAR`, `MONTH`, `DAY`, `HOUR`, `MINUTE`, `SECOND`,
  `DATE_ADD`, `DATE_SUB`, `DATE_FORMAT`, `STR_TO_DATE`, `DATEDIFF`, `TIMESTAMPDIFF`, `INTERVAL`,
  `LAST_INSERT_ID`, `FOUND_ROWS`, `ROW_NUMBER`, `RANK`, `DENSE_RANK`, `OVER`, `PARTITION`,
  `ASC`, `DESC`, `KEY`, `PRIMARY`, `FOREIGN`, `REFERENCES`, `TABLE`, `INDEX`, `VIEW`,
  `CREATE`, `ALTER`,
  `COMMIT`, `ROLLBACK`, `TRANSACTION`, `BEGIN`, `DECLARE`, `EXECUTE`, `PROCEDURE`, `FUNCTION`, `TRIGGER`,
  `FOR`, `EACH`, `WITH`, `RECURSIVE`, `RETURNING`,
] as const;

const DANGER_KEYWORDS = [`DROP`, `TRUNCATE`, `GRANT`, `REVOKE`, `KILL`, `SHUTDOWN`, `PURGE`, `FLUSH`, `RESET`] as const;

// 1-2. 키워드 매칭 정규식 생성 (lastIndex 상태 공유를 피하기 위해 매 호출 생성)
export const getKeywordRegex = (): RegExp => new RegExp(`\\b(?:${SQL_KEYWORDS.join(`|`)})\\b`, `gi`);

// 1-3. 위험 키워드 매칭 정규식 생성
export const getDangerRegex = (): RegExp => new RegExp(`\\b(?:${DANGER_KEYWORDS.join(`|`)})\\b`, `gi`);
