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
  경제학개론: "economics",
  공직선거법: "public-official-election-act",
  관세법개론: "customs-law",
  교정학개론: "corrections",
  국제법개론: "international-law",
  "네트워크 보안": "network-security",
  노동법개론: "labor-law",
  데이터베이스론: "database-theory",
  무선공학개론: "wireless-engineering",
  세법개론: "tax-law",
  알고리즘: "algorithms",
  "정보시스템 보안": "information-systems-security",
  "조경계획 및 설계": "landscape-planning-design",
  조경학: "landscape-architecture",
  "직업상담ㆍ심리학개론": "vocational-counseling-psychology",
  통계학개론: "statistics",
  형법총론: "criminal-law-general",
  형사소송법: "criminal-procedure-law",
  형사소송법개론: "criminal-procedure-theory",
  형사정책개론: "criminal-policy",
  회계원리: "accounting-principles",
  프로그래밍언어론: "programming-languages",
  // 7급 국가직 전용 과목 (9급 동명 과목과 이름이 달라 별도 과목으로 등록)
  건축계획학: "architectural-planning-7",
  건축구조학: "architectural-structure-7",
  건축시공학: "architectural-construction",
  경영학: "business-administration",
  경제학: "economics-7",
  관세법: "customs-law-7",
  교육학: "education-theory-7",
  교정학: "corrections-7",
  국제법: "international-law-7",
  국제정치학: "international-politics",
  기계공작법: "manufacturing-processes",
  노동법: "labor-law-7",
  도시계획: "urban-planning",
  독어: "german",
  러시아어: "russian",
  무역학: "international-trade",
  물리학개론: "physics",
  민법: "civil-law",
  민사소송법: "civil-procedure-law",
  반응공학: "reaction-engineering",
  방재관계법규: "disaster-prevention-law",
  불어: "french",
  상황판단: "situational-judgment",
  생물학개론: "biology",
  생태학: "ecology",
  세법: "tax-law-7",
  소프트웨어공학: "software-engineering",
  수리수문학: "hydraulics-hydrology",
  스페인어: "spanish",
  식용작물학: "crop-science-7",
  심리학: "psychology",
  언어논리: "verbal-reasoning",
  응용역학: "applied-mechanics-7",
  인공지능: "artificial-intelligence",
  "인사ㆍ조직론": "hr-organization-theory",
  일어: "japanese",
  임업경영학: "forestry-management-7",
  자동제어: "automatic-control",
  자료구조론: "data-structures",
  자료해석: "data-interpretation",
  재배학: "crop-cultivation-7",
  전기자기학: "electromagnetism",
  전달현상: "transport-phenomena",
  전자회로: "electronic-circuits",
  조림학: "silviculture",
  중국어: "chinese",
  토양학: "soil-science",
  토질역학: "soil-mechanics",
  통계학: "statistics-7",
  형사정책: "criminal-policy-7",
  화공열역학: "chemical-thermodynamics",
  화학개론: "chemistry-intro",
  환경계획: "environmental-planning",
  환경공학: "environmental-engineering-7",
  회로이론: "circuit-theory",
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
