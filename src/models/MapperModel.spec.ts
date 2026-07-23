import { describe, expect, test } from "bun:test";
import { parseXmlMapper } from "./MapperModel";

// 1. XML mapper 파싱 -------------------------------------------------------------------------
describe(`parseXmlMapper`, () => {
  test(`indexes statements, resultMaps, and SQL fragments`, () => {
    const xml = `
<mapper namespace="com.example.UserMapper">
  <resultMap id="userMap" type="User">
    <id property="id" column="id" />
  </resultMap>
  <sql id="baseColumns">
    id, name
  </sql>
  <select id="findUser" resultMap="userMap">
    SELECT <include refid="baseColumns" /> FROM user
  </select>
</mapper>`;

    const mapper = parseXmlMapper(`UserMapper.xml`, xml);

    expect(mapper?.namespace).toBe(`com.example.UserMapper`);
    expect(mapper?.resultMaps.map((item) => item.id)).toEqual([`userMap`]);
    expect(mapper?.fragments.map((item) => item.id)).toEqual([`baseColumns`]);
    expect(mapper?.statements.map((item) => item.id)).toEqual([`findUser`]);
  });
});
