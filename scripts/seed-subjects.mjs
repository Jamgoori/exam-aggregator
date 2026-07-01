// 1회성 헬퍼: testpaper 폴더 파일명 기준으로 아직 DB에 없는 과목을 추가한다.
import { createClient } from "@supabase/supabase-js";

const SLUGS = {
  간호관리: "nursing-management",
  건축계획: "architectural-planning",
  건축구조: "architectural-structure",
  공업화학: "industrial-chemistry",
  공중보건: "public-health",
  교육학개론: "education-theory",
  기계설계: "mechanical-design",
  기계일반: "mechanical-engineering",
  보건행정: "health-administration",
  사회복지학개론: "social-welfare",
  식용작물: "crop-science",
  안전관리론: "safety-management",
  응용역학개론: "applied-mechanics",
  임업경영: "forestry-management",
  자료조직개론: "library-cataloging",
  재난관리론: "disaster-management",
  재배학개론: "crop-cultivation",
  전기기기: "electrical-machinery",
  전기이론: "electrical-theory",
  전자공학개론: "electronics-engineering",
  정보보호론: "information-security",
  정보봉사개론: "library-reference-service",
  조림: "afforestation",
  지방세법: "local-tax-law",
  지역사회간호: "community-health-nursing",
  지적전산학개론: "cadastral-informatics",
  지적측량: "cadastral-surveying",
  컴퓨터일반: "computer-science",
  토목설계: "civil-engineering-design",
  통신이론: "communication-theory",
  화학: "chemistry",
  화학공학일반: "chemical-engineering",
  환경공학개론: "environmental-engineering",
  회계학: "accounting",
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const { data: existing } = await supabase.from("subjects").select("name");
const existingNames = new Set(existing.map((s) => s.name));

const { data: maxOrderRow } = await supabase
  .from("subjects")
  .select("display_order")
  .order("display_order", { ascending: false })
  .limit(1)
  .single();

let order = (maxOrderRow?.display_order ?? 0) + 1;

const rows = Object.entries(SLUGS)
  .filter(([name]) => !existingNames.has(name))
  .map(([name, slug]) => ({ name, slug, display_order: order++ }));

if (rows.length === 0) {
  console.log("추가할 과목 없음.");
} else {
  const { error } = await supabase.from("subjects").insert(rows);
  if (error) throw error;
  console.log(`추가됨 (${rows.length}개):`, rows.map((r) => r.name).join(", "));
}
