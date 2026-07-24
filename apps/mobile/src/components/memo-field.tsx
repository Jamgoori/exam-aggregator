import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { getMemo, saveMemo } from "../lib/memo";
import { colors } from "../theme/colors";

// 문항 메모: 접었다 폈다 하는 입력. 포커스 잃을 때 저장. 로그인 사용자만 의미 있음.
export function MemoField({
  paperId,
  questionNumber,
}: {
  paperId: string;
  questionNumber: number;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    getMemo(paperId, questionNumber)
      .then((m) => {
        if (!alive) return;
        setValue(m);
        setLoaded(true);
        if (m) setOpen(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      alive = false;
    };
  }, [paperId, questionNumber]);

  async function persist() {
    try {
      await saveMemo(paperId, questionNumber, value);
    } catch {
      // 저장 실패는 조용히 무시(다음 저장 때 재시도)
    }
  }

  if (!loaded) return null;

  return (
    <View style={{ marginTop: 8 }}>
      {!open ? (
        <Pressable onPress={() => setOpen(true)}>
          <Text style={{ color: colors.primary, fontSize: 13 }}>
            {value ? "📝 메모 보기" : "＋ 메모 추가"}
          </Text>
        </Pressable>
      ) : (
        <TextInput
          value={value}
          onChangeText={setValue}
          onBlur={persist}
          placeholder="이 문항 메모 (자동 저장)"
          placeholderTextColor={colors.textMuted}
          multiline
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 10,
            padding: 10,
            minHeight: 60,
            color: colors.text,
            fontSize: 14,
          }}
        />
      )}
    </View>
  );
}
