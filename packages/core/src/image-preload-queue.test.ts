import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createImagePreloadQueue,
  orderPreloadTargets,
  type PreloadTarget,
} from "./image-preload-queue";

// 문항 이미지 미리받기 큐의 계약.
//
// 지키려는 건 두 가지다. (1) 지금 보고 있는 문항이 언제나 제일 먼저 나간다. (2) 한
// 번에 나가는 요청 수가 제한된다 — 예전처럼 전 문항을 한꺼번에 요청하면 눈앞의 문항이
// 나머지와 대역폭을 나눠 쓰느라 늦게 뜬다.
//
// 실행: npm run test (apps/web).

function imagesFor(count: number): string[][] {
  return Array.from({ length: count }, (_, i) => [`q${i}.webp`]);
}

// 받기 시작한 순서를 기록하고, 아무 것도 끝내지 않는(=계속 받는 중인) 가짜 로더.
function pendingLoader() {
  const started: PreloadTarget[] = [];
  const finishers: (() => void)[] = [];
  return {
    started,
    start(target: PreloadTarget, done: () => void) {
      started.push(target);
      finishers.push(done);
    },
    finishAll() {
      const pending = finishers.splice(0);
      for (const done of pending) done();
    },
  };
}

test("지금 보는 문항 → 뒤쪽 → 앞쪽(가까운 순) 으로 순서를 매긴다", () => {
  const order = orderPreloadTargets(imagesFor(5), 2).map((t) => t.src);
  assert.deepEqual(order, ["q2.webp", "q3.webp", "q4.webp", "q1.webp", "q0.webp"]);
});

test("한 문항에 이미지가 여러 장이면 그 문항 안에서는 등록 순서를 지킨다", () => {
  const order = orderPreloadTargets([["a1", "a2"], ["b1"]], 0);
  assert.deepEqual(order, [
    { src: "a1", itemIndex: 0 },
    { src: "a2", itemIndex: 0 },
    { src: "b1", itemIndex: 1 },
  ]);
});

test("동시 요청은 concurrency 개까지만 나가고, 끝난 만큼 다음 장이 이어진다", () => {
  const loader = pendingLoader();
  const queue = createImagePreloadQueue({ start: loader.start, concurrency: 2 });

  queue.prioritize(imagesFor(5), 0);
  assert.deepEqual(
    loader.started.map((t) => t.src),
    ["q0.webp", "q1.webp"],
  );

  loader.finishAll();
  assert.deepEqual(
    loader.started.map((t) => t.src),
    ["q0.webp", "q1.webp", "q2.webp", "q3.webp"],
  );
});

test("문항을 넘기면 아직 안 받은 이미지는 그 문항부터 다시 줄을 세운다", () => {
  const loader = pendingLoader();
  const queue = createImagePreloadQueue({ start: loader.start, concurrency: 1 });

  queue.prioritize(imagesFor(10), 0);
  loader.finishAll(); // q0 완료 → q1 진행 중
  // 사용자가 8번 문항으로 건너뛴다.
  queue.prioritize(imagesFor(10), 8);
  loader.finishAll(); // 진행 중이던 q1 완료 → 다음은 8번이어야 한다

  assert.deepEqual(
    loader.started.map((t) => t.src),
    ["q0.webp", "q1.webp", "q8.webp"],
  );
});

test("이미 받은 이미지는 다시 요청하지 않는다 (세트문제는 여러 문항이 같은 이미지를 쓴다)", () => {
  const loader = pendingLoader();
  const queue = createImagePreloadQueue({ start: loader.start, concurrency: 4 });

  // 3~4번 문항이 같은 공통지문 이미지를 가리키는 세트문제.
  const images = [["q0.webp"], ["set.webp"], ["set.webp"], ["q3.webp"]];
  queue.prioritize(images, 0);
  loader.finishAll();
  queue.prioritize(images, 1);
  loader.finishAll();

  assert.deepEqual(
    loader.started.map((t) => t.src),
    ["q0.webp", "set.webp", "q3.webp"],
  );
});

test("캐시에 있어 done이 동기로 불려도 큐가 멈추지 않는다", () => {
  const started: string[] = [];
  const queue = createImagePreloadQueue({
    start: (target, done) => {
      started.push(target.src);
      done();
    },
    concurrency: 2,
  });

  queue.prioritize(imagesFor(4), 0);
  assert.deepEqual(started, ["q0.webp", "q1.webp", "q2.webp", "q3.webp"]);
  assert.equal(queue.pendingCount(), 0);
});

test("stop 이후에는 남은 대기열을 더 받지 않는다", () => {
  const loader = pendingLoader();
  const queue = createImagePreloadQueue({ start: loader.start, concurrency: 1 });

  queue.prioritize(imagesFor(5), 0);
  queue.stop();
  loader.finishAll();
  queue.prioritize(imagesFor(5), 0);

  assert.deepEqual(
    loader.started.map((t) => t.src),
    ["q0.webp"],
  );
});
