import { router, type Href } from "expo-router";
import { Alert, Linking, Pressable, View } from "react-native";
import { AppText } from "./app-text";
import { openLegal, type LegalDoc } from "../lib/legal";

// 푸터(웹 site-footer.tsx, 설계서 §4.4). 몰입 화면 밖 모든 화면 끝에. 약관·개인정보는
// 시스템 브라우저 시트, "문의"는 mailto. 사업자 표기(BusinessInfo)는 웹 lib/business.ts 가
// 비어 있어 아직 그리지 않는다 — 채워지면 core 로 옮겨 여기서도 그린다.
const LINKS: { label: string; href: string; bold?: boolean }[] = [
  { label: "기출문제 검색", href: "/papers" },
  { label: "시험별 기출문제", href: "/exams" },
  { label: "과목별 기출문제", href: "/subjects" },
  { label: "멤버십 요금제", href: "/membership" },
  { label: "자유게시판", href: "/board" },
  { label: "공지사항", href: "/notices" },
  { label: "건의게시판", href: "/suggestions" },
];

const LEGAL: { label: string; doc: LegalDoc; bold?: boolean }[] = [
  { label: "이용약관", doc: "terms" },
  { label: "개인정보처리방침", doc: "privacy", bold: true },
];

const CONTACT_MAILTO = "mailto:lks2354@gmail.com";

async function openDoc(doc: LegalDoc) {
  try {
    await openLegal(doc);
  } catch (e) {
    Alert.alert("문서를 열 수 없어요", e instanceof Error ? e.message : "");
  }
}

function FooterLink({ label, bold, onPress }: { label: string; bold?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="link" onPress={onPress} hitSlop={6}>
      <AppText variant="xs" weight={bold ? "medium" : undefined} className="text-zinc-400 dark:text-zinc-500">
        {label}
      </AppText>
    </Pressable>
  );
}

export function AppFooter() {
  return (
    <View className="mt-6 border-t border-zinc-100 dark:border-zinc-800">
      <View className="w-full max-w-5xl gap-2 self-center px-4 py-6">
        <View className="flex-row flex-wrap gap-x-4 gap-y-1">
          {LINKS.map((l) => (
            <FooterLink key={l.href} label={l.label} onPress={() => router.push(l.href as Href)} />
          ))}
          {LEGAL.map((l) => (
            <FooterLink key={l.doc} label={l.label} bold={l.bold} onPress={() => void openDoc(l.doc)} />
          ))}
          <FooterLink label="문의" onPress={() => void Linking.openURL(CONTACT_MAILTO).catch(() => {})} />
        </View>
        <AppText variant="xs" className="text-zinc-400 dark:text-zinc-500">
          © 2026 공모아 — 공무원 기출문제 자료실
        </AppText>
      </View>
    </View>
  );
}
