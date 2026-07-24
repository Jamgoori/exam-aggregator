import { storagePublicUrl } from "./clients.ts";

// 문제지들의 문항 이미지·선지 수 조회. 웹 fetchQuestionMedia 의 최소판.
// deno-lint-ignore-file no-explicit-any
export type QMedia = { images: string[]; choiceCount: number };

export async function fetchQuestionMedia(
  admin: any,
  paperIds: string[],
): Promise<Map<string, Map<number, QMedia>>> {
  const out = new Map<string, Map<number, QMedia>>();
  if (paperIds.length === 0) return out;

  const { data } = await admin
    .from("questions")
    .select("paper_id, question_number, choice_count, question_images(order_index, image_path)")
    .in("paper_id", paperIds);

  for (const q of data ?? []) {
    const images = [...((q.question_images as
      | { order_index: number; image_path: string }[]
      | null) ?? [])]
      .sort((a, b) => a.order_index - b.order_index)
      .map((img) => storagePublicUrl(img.image_path));
    if (!out.has(q.paper_id)) out.set(q.paper_id, new Map());
    out.get(q.paper_id)!.set(q.question_number, {
      images,
      choiceCount: q.choice_count as number,
    });
  }
  return out;
}
