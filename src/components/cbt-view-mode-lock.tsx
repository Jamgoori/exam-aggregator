"use client";

import { useEffect, useState, useTransition } from "react";
import { Lock, LockOpen, X } from "lucide-react";
import { setDefaultCbtViewMode } from "@/app/actions";

// 자물쇠 버튼 안내 말풍선을 "다시 보지 않기"로 닫으면 이 기기/브라우저에 그 사실을
// 남겨두는 키. 계정(user_metadata)이 아니라 로컬에만 남기는 이유는, 이건 실제 설정값이
// 아니라 UI를 처음 보는 사람에게만 필요한 안내라서 서버 왕복까지 갈 필요가 없어서다.
const LOCK_HINT_STORAGE_KEY = "cbt-lock-hint-dismissed";

// 자물쇠 아이콘: 지금 보고 있는 모드(전체보기/문제별 풀기)를 계정의 기본 시작
// 모드로 저장하는 토글이다. 저장된 기본값·저장 중 상태·첫 방문 안내 말풍선까지
// 자물쇠에 관련된 상태는 전부 이 컴포넌트가 스스로 관리한다.
export function CbtViewModeLock({
  viewMode,
  initialDefaultViewMode,
}: {
  viewMode: "full" | "single";
  // 계정에 명시적으로 저장된 시작 모드. 자물쇠를 한 번도 안 눌러본 계정은 null.
  initialDefaultViewMode: "full" | "single" | null;
}) {
  const [savedDefaultViewMode, setSavedDefaultViewMode] = useState(
    initialDefaultViewMode,
  );
  const [isSavingDefault, startSavingDefault] = useTransition();
  const [lockHintVisible, setLockHintVisible] = useState(false);
  const [dontShowLockHint, setDontShowLockHint] = useState(false);

  // 자물쇠 버튼은 아이콘만 봐서는 기능을 짐작하기 어려워서, 처음 들어왔을 때 한 번
  // 말풍선으로 짚어준다. 로딩 직후 다른 UI와 뒤섞여 나타나지 않게 살짝 지연을 둔다.
  useEffect(() => {
    if (localStorage.getItem(LOCK_HINT_STORAGE_KEY)) return;
    const timeout = setTimeout(() => setLockHintVisible(true), 600);
    return () => clearTimeout(timeout);
  }, []);

  function dismissLockHint(persist: boolean) {
    setLockHintVisible(false);
    if (persist) localStorage.setItem(LOCK_HINT_STORAGE_KEY, "1");
  }

  // 지금 보고 있는 모드가 이미 저장된 기본 시작 모드와 같으면(자물쇠가 잠긴 상태)
  // "켜져 있다"는 뜻이다.
  const isDefaultViewModeLocked = savedDefaultViewMode === viewMode;

  // 이미 잠겨 있는 상태에서 다시 누르면 저장된 기본값을 지워서(null) 잠금을
  // 해제한다 — 그냥 같은 값을 다시 저장만 하면 잠긴 채로 아무 변화도 안 보여서
  // 껐는지 켰는지 구분이 안 됐다.
  function handleToggleDefaultViewMode() {
    if (isSavingDefault) return;
    // 실제로 눌러봤다는 건 이미 기능을 파악했다는 뜻이므로, 체크 여부와 무관하게
    // 안내를 다시 띄우지 않는다.
    if (lockHintVisible) dismissLockHint(true);
    const previousDefault = savedDefaultViewMode;
    const nextDefault = isDefaultViewModeLocked ? null : viewMode;
    // 서버 응답을 기다리지 않고 즉시 아이콘부터 바꾼다(낙관적 업데이트). 실패하면
    // 원래 상태로 되돌린다.
    setSavedDefaultViewMode(nextDefault);
    startSavingDefault(async () => {
      const res = await setDefaultCbtViewMode(nextDefault);
      if (res.error) setSavedDefaultViewMode(previousDefault);
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleToggleDefaultViewMode}
        disabled={isSavingDefault}
        aria-pressed={isDefaultViewModeLocked}
        aria-label={
          isDefaultViewModeLocked
            ? "저장된 시작 모드 해제하기"
            : "이 모드를 시작 모드로 저장"
        }
        title={
          isDefaultViewModeLocked
            ? "다음 온라인 응시부터 이 모드로 시작해요. 누르면 해제해요"
            : "누르면 다음 온라인 응시부터 이 모드로 시작해요"
        }
        className={`flex items-center justify-center rounded-full p-1.5 disabled:opacity-50 ${
          isDefaultViewModeLocked
            ? "bg-blue-600 text-white"
            : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
        }`}
      >
        {isDefaultViewModeLocked ? (
          <Lock size={16} />
        ) : (
          <LockOpen size={16} />
        )}
      </button>

      {lockHintVisible && (
        <div className="absolute left-1/2 top-full z-30 mt-2 w-56 -translate-x-1/2 rounded-xl bg-blue-600 p-3 text-white shadow-lg shadow-blue-600/30">
          <div className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 bg-blue-600" />
          <button
            type="button"
            aria-label="안내 닫기"
            onClick={() => dismissLockHint(dontShowLockHint)}
            className="absolute right-2 top-2 text-blue-200 hover:text-white dark:text-blue-300 dark:hover:text-white"
          >
            <X size={14} />
          </button>
          <p className="pr-4 text-xs font-medium leading-relaxed">
            자물쇠를 누르면 이 모드를 기본값으로 저장해요. 다음
            응시부터 바로 이 화면으로 열려요.
          </p>
          <label className="mt-2 flex items-center gap-1.5 text-[11px] text-blue-100">
            <input
              type="checkbox"
              checked={dontShowLockHint}
              onChange={(e) => setDontShowLockHint(e.target.checked)}
              className="h-3 w-3 accent-white"
            />
            다시 보지 않기
          </label>
        </div>
      )}
    </div>
  );
}
