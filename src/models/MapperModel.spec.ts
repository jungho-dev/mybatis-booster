import { describe, expect, test } from "bun:test";
import { extractSqlFragment, extractStatementXml, findCallSiteAt, findLogStatementRef, parseJavaMapper, parseXmlMapper, renderPreviewSql, resolveReceiverType, resolveTypeCandidates, splitLogParamTokens } from "./MapperModel";

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

  test(`collects bindings, local vars, and references, skipping comments`, () => {
    const xml = `
<mapper namespace="com.example.OrderMapper">
  <resultMap id="orderMap" type="Order" extends="baseMap">
    <id property="id" column="id" />
  </resultMap>
  <sql id="cols">id, name</sql>
  <select id="findOrder" resultMap="orderMap">
    SELECT <include refid="cols" /> FROM orders WHERE id = #{orderId} AND status = #{cond.status}
  </select>
  <select id="listOrders">
    <bind name="pattern" value="'%' + keyword + '%'" />
    <foreach collection="ids" item="itemId" index="idx" separator=",">
      #{itemId}
    </foreach>
    #{pattern}
  </select>
  <!-- <select id="ghost">SELECT #{ghostParam} FROM dual</select> -->
</mapper>`;

    const mapper = parseXmlMapper(`OrderMapper.xml`, xml);
    const findOrder = mapper?.statements[0];
    const listOrders = mapper?.statements[1];

    expect(mapper?.statements.map((item) => item.id)).toEqual([`findOrder`, `listOrders`]);
    expect(findOrder?.bindings.map((binding) => binding.root)).toEqual([`orderId`, `cond`]);
    expect(listOrders?.bindings.map((binding) => binding.root)).toEqual([`itemId`, `pattern`]);
    expect([...(listOrders?.localVars ?? [])].sort()).toEqual([`idx`, `itemId`, `pattern`]);
    expect(mapper?.references.map((ref) => `${ref.kind}:${ref.value}`).sort()).toEqual([`include:cols`, `resultMap:baseMap`, `resultMap:orderMap`]);
  });

  test(`collects foreach collections and test expressions`, () => {
    const xml = `
<mapper namespace="com.example.CondMapper">
  <select id="search">
    <where>
      <if test="type == 'Y'">AND type = #{type}</if>
      <if test='status == "ACTIVE"'>AND status = #{status}</if>
      <foreach collection="filter.ids" item="fid" separator=",">#{fid}</foreach>
    </where>
  </select>
</mapper>`;

    const mapper = parseXmlMapper(`CondMapper.xml`, xml);

    expect(mapper?.statements[0]?.collections.map((item) => item.root)).toEqual([`filter`]);
    expect(mapper?.testExprs.map((item) => item.value)).toEqual([`type == 'Y'`, `status == "ACTIVE"`]);
  });

  test(`records the closing tag line as the statement end boundary`, () => {
    const xml = `
<mapper namespace="com.example.UserMapper">
  <select id="findUser">
    SELECT 1
  </select>
  <resultMap id="userMap" type="User"/>
</mapper>`;

    const statement = parseXmlMapper(`UserMapper.xml`, xml)?.statements[0];

    expect(statement?.line).toBe(2);
    expect(statement?.endLine).toBe(4);
  });

  test(`collects nested select refs and databaseId variants`, () => {
    const xml = `
<mapper namespace="com.example.OrderMapper">
  <resultMap id="orderMap" type="Order">
    <collection property="items" column="order_id" select="selectItemsByOrderId"/>
    <association property="buyer" column="buyer_id" select="com.example.UserMapper.selectUser"/>
  </resultMap>
  <select id="selectItemsByOrderId" resultType="Item">SELECT * FROM item WHERE order_id = #{orderId}</select>
  <select id="findSeq" databaseId="oracle">SELECT SEQ.NEXTVAL FROM DUAL</select>
  <select id="findSeq" databaseId="mysql">SELECT LAST_INSERT_ID()</select>
</mapper>`;

    const mapper = parseXmlMapper(`OrderMapper.xml`, xml);

    expect(mapper?.selectRefs).toEqual([`selectItemsByOrderId`, `com.example.UserMapper.selectUser`]);
    expect(mapper?.statements.map((item) => `${item.id}@${item.databaseId}`)).toEqual([`selectItemsByOrderId@`, `findSeq@oracle`, `findSeq@mysql`]);
  });
});

// 1-2. SQL 미리보기 렌더링 -------------------------------------------------------------------
describe(`renderPreviewSql`, () => {
  test(`expands include, where, if, foreach, choose, and CDATA`, () => {
    const statementXml = `<select id="search" resultMap="userMap">
    SELECT <include refid="cols"/> FROM users
    <where>
      <if test="name != null">AND name = #{name}</if>
      <foreach collection="ids" item="id" open="AND id IN (" close=")" separator=",">#{id}</foreach>
      <choose>
        <when test="sort != null">AND created_at <![CDATA[ >= ]]> #{fromDate}</when>
        <otherwise>AND 1 = 1</otherwise>
      </choose>
    </where>
  </select>`;
    const fragments = new Map([[`cols`, `id, name`]]);

    const sql = renderPreviewSql(statementXml, fragments);

    expect(sql).toContain(`SELECT`);
    expect(sql).toContain(`id, name`);
    expect(sql).toContain(`WHERE`);
    expect(sql).toContain(`name = #{name}`);
    expect(sql).toContain(`AND id IN (`);
    expect(sql).toContain(`>=`);
    expect(sql).not.toContain(`1 = 1`);
    expect(sql).not.toContain(`<if`);
    expect(sql).not.toContain(`<where`);
    expect(sql).not.toContain(`<include`);
  });

  test(`extracts statement xml and sql fragment body`, () => {
    const xml = `
<mapper namespace="com.example.UserMapper">
  <sql id="cols">id, name</sql>
  <select id="findUser">SELECT <include refid="cols"/> FROM users</select>
</mapper>`;

    expect(extractStatementXml(xml, `findUser`, `select`)).toBe(`<select id="findUser">SELECT <include refid="cols"/> FROM users</select>`);
    expect(extractSqlFragment(xml, `cols`)).toBe(`id, name`);
    expect(extractSqlFragment(xml, `missing`)).toBeUndefined();
  });
});

// 1-3. 로그 statement 참조 추출 ---------------------------------------------------------------
describe(`findLogStatementRef`, () => {
  test(`extracts the last Class.method pair before Preparing`, () => {
    const log = `2026-07-23 10:00:00 DEBUG [http-nio-8080-exec-1] c.e.m.UserMapper.selectUser - ==> Preparing: SELECT * FROM users WHERE id = ?\n==> Parameters: 1(Long)`;

    expect(findLogStatementRef(log)).toEqual({ "simpleName": `UserMapper`, "methodId": `selectUser` });
    expect(findLogStatementRef(`no preparing line here`)).toBeUndefined();
  });

  test(`extracts uppercase-leading method ids`, () => {
    const log = `DEBUG i.w.c.m.p.PaymentMapper.HPAuthSearch - ==> Preparing: SELECT 1`;

    expect(findLogStatementRef(log)).toEqual({ "simpleName": `PaymentMapper`, "methodId": `HPAuthSearch` });
  });
});

// 1-4. Parameters 토큰 분리 ------------------------------------------------------------------
describe(`splitLogParamTokens`, () => {
  test(`merges commas inside values using the type suffix boundary`, () => {
    expect(splitLogParamTokens(`Seoul, Gangnam-gu(String), 3(Long), null`).map((token) => token.trim())).toEqual([`Seoul, Gangnam-gu(String)`, `3(Long)`, `null`]);
    expect(splitLogParamTokens(`1(Long), Y(String)`).map((token) => token.trim())).toEqual([`1(Long)`, `Y(String)`]);
  });
});

// 2. Java mapper 파싱 ------------------------------------------------------------------------
describe(`parseJavaMapper`, () => {
  test(`indexes annotated interface methods with modifiers and multiline params`, () => {
    const java = `
package com.example;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface UserMapper {
  List<User> findUser(
    @Param("id") Long id
  );

  public abstract int updateUser(User user) throws SQLException;

  default boolean existsUser(Long id) {
    return findUser(id) != null;
  }
}`;

    const mapper = parseJavaMapper(java);

    expect(mapper?.packageName).toBe(`com.example`);
    expect(mapper?.interfaceName).toBe(`UserMapper`);
    expect(mapper?.hasMapperAnnotation).toBe(true);
    expect(mapper?.methods.map((item) => item.name)).toEqual([`findUser`, `updateUser`, `existsUser`]);
    expect(mapper?.methods.map((item) => item.hasBody)).toEqual([false, false, true]);
  });

  test(`parses @Param names, generic params, and special params`, () => {
    const java = `
package com.example;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface OrderMapper {
  List<Order> findOrder(@Param("orderId") Long orderId, @Param("cond") Map<String, Object> cond);

  List<Order> listOrders(@Param("ids") List<Long> ids, RowBounds bounds);

  int updateOrder(Order order);

  int countAll();
}`;

    const mapper = parseJavaMapper(java);
    const [findOrder, listOrders, updateOrder, countAll] = mapper?.methods ?? [];

    expect(findOrder?.paramNames).toEqual([`orderId`, `cond`]);
    expect(findOrder?.paramCount).toBe(2);
    expect(findOrder?.allParamsNamed).toBe(true);
    expect(listOrders?.paramNames).toEqual([`ids`]);
    expect(listOrders?.allParamsNamed).toBe(true);
    expect(updateOrder?.paramCount).toBe(1);
    expect(updateOrder?.allParamsNamed).toBe(false);
    expect(countAll?.paramCount).toBe(0);
    expect(countAll?.allParamsNamed).toBe(true);
  });

  test(`flags annotation-based SQL methods`, () => {
    const java = `
package com.example;

public interface TagMapper {
  @Select("SELECT * FROM tag WHERE id = #{id}")
  Tag findTag(@Param("id") Long id);

  int insertTag(Tag tag);
}`;

    const mapper = parseJavaMapper(java);

    expect(mapper?.methods.map((item) => item.name)).toEqual([`findTag`, `insertTag`]);
    expect(mapper?.methods.map((item) => item.hasSqlAnnotation)).toEqual([true, false]);
  });

  test(`parses methods without a space after generic return types`, () => {
    const java = `
package com.example;

public interface ExcelMapper {
  Cursor<MerchantInfoDTO>fetchMerchantInfo(Map<String, Object> params);

  String[]fetchCodes(Map<String, Object> params);
}`;

    const mapper = parseJavaMapper(java);

    expect(mapper?.methods.map((item) => item.name)).toEqual([`fetchMerchantInfo`, `fetchCodes`]);
  });

  test(`ignores commented-out methods and detects inheritance`, () => {
    const java = `
package com.example;

public interface ChildMapper extends BaseMapper<User> {
  // int oldFind(Map<String, Object> param);
  /* int blockOld(Map<String, Object> param); */
  int findChild(Map<String, Object> param);
}`;

    const mapper = parseJavaMapper(java);

    expect(mapper?.interfaceName).toBe(`ChildMapper`);
    expect(mapper?.hasParent).toBe(true);
    expect(mapper?.methods.map((item) => item.name)).toEqual([`findChild`]);
  });

  test(`does not treat an annotation type as a mapper interface`, () => {
    const java = `
package com.example;

public @interface MyAnnotation {
  String value();
}`;

    expect(parseJavaMapper(java)).toBeNull();
  });

  test(`keeps SQL annotations containing parentheses and skips method bodies`, () => {
    const java = `
package com.example;

public interface TagMapper {
  @Select("SELECT COUNT(*) FROM tag")
  int countTags();

  @Insert("INSERT INTO tag (id, name) VALUES (#{id}, #{name})")
  int insertTag(@Param("id") Long id, @Param("name") String name);

  Tag findTag(@Param("id") Long id);

  default Tag findOrThrow(Long id) {
    Tag tag = findTag(id);
    if (tag == null) {
      throw new IllegalArgumentException("id");
    }
    return tag;
  }
}`;

    const mapper = parseJavaMapper(java);

    expect(mapper?.methods.map((item) => item.name)).toEqual([`countTags`, `insertTag`, `findTag`, `findOrThrow`]);
    expect(mapper?.methods.map((item) => item.hasSqlAnnotation)).toEqual([true, true, false, false]);
    expect(mapper?.methods.map((item) => item.hasBody)).toEqual([false, false, false, true]);
  });

  test(`locates the method name even when a param name repeats it`, () => {
    const java = `
package com.example;

public interface OrderMapper {
  Order find(@Param("find") String findKeyword);
}`;

    const mapper = parseJavaMapper(java);

    expect(mapper?.methods.map((item) => item.name)).toEqual([`find`]);
    expect(mapper?.methods[0]?.paramNames).toEqual([`find`]);
    expect(mapper?.methods[0]?.allParamsNamed).toBe(true);
  });

  test(`stops method collection at the interface closing brace`, () => {
    const java = `
package com.example;

public interface UserMapper {
  int findUser(Long id);
}

interface HiddenHelper {
  int hiddenMethod(Long id);
}`;

    const mapper = parseJavaMapper(java);

    expect(mapper?.interfaceName).toBe(`UserMapper`);
    expect(mapper?.methods.map((item) => item.name)).toEqual([`findUser`]);
  });

  test(`ignores members of types nested inside the interface`, () => {
    const java = `
package com.example;

public interface OrderMapper {
  int findOrder(Long id);

  class Helper {
    int helperMethod(Long id) {
      return 0;
    }
  }

  interface Callback {
    void onDone(Long id);
  }
}`;

    expect(parseJavaMapper(java)?.methods.map((item) => item.name)).toEqual([`findOrder`]);
  });

  test(`does not treat a string literal or a nested interface as the mapper`, () => {
    const literal = `
package com.example;

public class UserService {
  private static final String NOTE = "interface Ghost";

  public int find(Long id) {
    return 0;
  }
}`;
    const nested = `
package com.example;

public class CallbackHolder {
  interface Callback {
    int onDone(Long id);
  }
}`;

    expect(parseJavaMapper(literal)).toBeNull();
    expect(parseJavaMapper(nested)).toBeNull();
  });

  test(`detects SQL annotations behind an annotation with nested parentheses`, () => {
    const java = `
package com.example;

public interface TagMapper {
  @Select("SELECT id, name FROM tag WHERE id = #{id}")
  @Results({ @Result(column = "id", property = "id"), @Result(column = "name", property = "name") })
  Tag findTag(@Param("id") Long id);

  int insertTag(Tag tag);
}`;

    const mapper = parseJavaMapper(java);

    expect(mapper?.methods.map((item) => item.name)).toEqual([`findTag`, `insertTag`]);
    expect(mapper?.methods.map((item) => item.hasSqlAnnotation)).toEqual([true, false]);
  });

  test(`records the declaration span including leading annotations`, () => {
    const java = `
package com.example;

public interface UserMapper {
  @Select("SELECT 1")
  int countUsers();

  default int twice() {
    return countUsers() * 2;
  }
}`;

    const [countUsers, twice] = parseJavaMapper(java)?.methods ?? [];

    expect([countUsers?.startLine, countUsers?.line, countUsers?.endLine]).toEqual([4, 5, 5]);
    expect([twice?.startLine, twice?.line, twice?.endLine]).toEqual([7, 7, 9]);
  });

  test(`does not treat a generic bound as interface inheritance`, () => {
    const java = `
package com.example;

public interface GenericMapper<T extends Object> {
  int insertItem(T item);
}`;

    expect(parseJavaMapper(java)?.hasParent).toBe(false);
  });
});

// 3. 호출부 해석 헬퍼 ---------------------------------------------------------------------------
describe(`call site helpers`, () => {
  test(`finds call site and resolves receiver type to FQCN candidates`, () => {
    const java = `
package com.example.service;

import com.example.mapper.UserMapper;
import com.example.dto.*;

public class UserServiceImpl {
  private final UserMapper userMapper;

  public User find(Long id) {
    return userMapper.selectUser(id);
  }
}`;
    const line = `    return userMapper.selectUser(id);`;

    const callSite = findCallSiteAt(line, line.indexOf(`selectUser`) + 2);

    expect(callSite).toEqual({ "receiver": `userMapper`, "method": `selectUser` });
    expect(findCallSiteAt(line, 0)).toBeUndefined();
    expect(resolveReceiverType(java, `userMapper`)).toBe(`UserMapper`);
    expect(resolveTypeCandidates(java, `UserMapper`)).toEqual([`com.example.mapper.UserMapper`, `com.example.service.UserMapper`, `com.example.dto.UserMapper`]);
  });

  test(`prefers the declaration nearest above the call site`, () => {
    const java = `
package com.example.service;

public class MixedService {
  private final UserMapper repo;

  public int viaLocal(Long id) {
    OrderMapper repo = null;
    return repo.selectOrder(id);
  }
}`;
    const callOffset = java.indexOf(`repo.selectOrder`);

    expect(resolveReceiverType(java, `repo`)).toBe(`UserMapper`);
    expect(resolveReceiverType(java, `repo`, callOffset)).toBe(`OrderMapper`);
  });

  test(`ignores commented-out imports when building FQCN candidates`, () => {
    const java = `
package com.example.service;

// import com.ghost.mapper.UserMapper;
import com.example.mapper.UserMapper;

public class UserServiceImpl {
}`;

    expect(resolveTypeCandidates(java, `UserMapper`)).toEqual([`com.example.mapper.UserMapper`, `com.example.service.UserMapper`]);
  });
});
