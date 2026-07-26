const {
  withAndroidManifest,
  withDangerousMod,
  withMainActivity,
  withMainApplication,
} = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

// 앱이 켜자마자 죽을 때 원인을 폰 화면에서 읽게 만드는 플러그인.
//
// 왜 필요한가: 릴리스 빌드가 시작 직후 종료되면 안드로이드는 "앱이 계속 중단됨" 한 줄만
// 보여주고 스택은 logcat 에만 남는다. logcat 은 PC + adb 가 있어야 읽는다. 폰만 가진
// 상태에서는 원인을 알 방법이 사실상 없어서, 지금까지 추측으로 고치고 다시 빌드하는 일을
// 반복했다(#115, #116, #117).
//
// JS 레벨 오류 화면(app/_layout.tsx 의 ErrorBoundary)으로는 부족하다. 그건 React 가
// 렌더를 시작한 뒤의 오류만 잡는다. 네이티브 초기화 실패(.so 로드 실패 등)나 번들
// 평가 단계의 throw 는 React 가 뜨기도 전이라 걸리지 않는다 — 실제 증상이 그 경우다.
//
// 그래서 자바 레벨의 마지막 관문인 UncaughtExceptionHandler 를 건다. RN 의 치명적 JS
// 오류도 여기까지 JavascriptException 으로 올라오므로 두 종류를 한 곳에서 받는다.
//
// 표시는 별도 프로세스(:crash)의 액티비티가 한다. 앱 프로세스는 곧 죽기 때문에 같은
// 프로세스에서 화면을 띄우면 같이 사라진다. MainApplication 은 :crash 프로세스에서
// RN 초기화를 건너뛰므로(그 초기화가 죽는 원인일 수 있다) 보고 화면은 항상 뜬다.

const CRASH_REPORT_KT = `package %%PACKAGE%%

import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Build
import android.system.Os
import android.system.OsConstants
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.system.exitProcess

// 시작 직후 죽는 오류를 파일에 남기고, 별도 프로세스의 화면으로 보여준다.
object CrashReport {
  private const val FILE_NAME = "last-crash.txt"
  const val EXTRA_TEXT = "crash_text"

  // 보고 화면 전용 프로세스인가. 이 프로세스에서는 RN 을 초기화하지 않는다 —
  // 초기화 자체가 죽는 원인일 때도 보고 화면은 떠야 하기 때문이다.
  fun isCrashProcess(context: Context): Boolean = processName().endsWith(":crash")

  fun install(application: Application) {
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, error ->
      save(application, error)
      try {
        show(application)
        // 보고 프로세스가 뜨기 전에 이 프로세스가 죽으면 화면이 안 보인다.
        Thread.sleep(700)
      } catch (ignored: Throwable) {
        // 화면을 못 띄워도 파일은 남았다 — 다음 실행에서 보여준다.
      }
      if (previous != null) previous.uncaughtException(thread, error) else exitProcess(2)
    }
  }

  // 죽지 않고 넘어가는 경로(Application.onCreate 의 try/catch)에서도 기록만 남긴다.
  fun save(context: Context, error: Throwable) {
    try {
      file(context).writeText(report(context, error))
    } catch (ignored: Throwable) {
      // 저장에 실패하면 할 수 있는 게 없다.
    }
  }

  fun hasReport(context: Context): Boolean = file(context).exists()

  // 한 번 보여준 보고서는 지운다. 안 지우면 다음 실행마다 같은 화면이 뜬다.
  fun consume(context: Context): String? {
    val target = file(context)
    if (!target.exists()) return null
    return try {
      val text = target.readText()
      target.delete()
      text
    } catch (ignored: Throwable) {
      target.delete()
      null
    }
  }

  fun show(context: Context) {
    val intent = Intent(context, CrashReportActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
    context.startActivity(intent)
  }

  private fun file(context: Context): File = File(context.filesDir, FILE_NAME)

  // 스택 외에 기기·빌드 정보를 같이 담는다. 메모리 페이지 크기(16 KB 기기에서는 16384)나
  // ABI 처럼 스크린샷 한 장으로 원인이 갈리는 값들이 여기 들어간다.
  private fun report(context: Context, error: Throwable): String {
    val writer = StringWriter()
    PrintWriter(writer, true).use { error.printStackTrace(it) }
    val stack = writer.toString()
    val versionName = try {
      context.packageManager.getPackageInfo(context.packageName, 0).versionName
    } catch (ignored: Throwable) {
      "?"
    }
    val pageSize = try {
      Os.sysconf(OsConstants._SC_PAGESIZE).toString()
    } catch (ignored: Throwable) {
      "?"
    }
    val time = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())
    return buildString {
      appendLine("time: " + time)
      appendLine("app: " + context.packageName + " " + versionName)
      appendLine("device: " + Build.MANUFACTURER + " " + Build.MODEL)
      appendLine("android: " + Build.VERSION.RELEASE + " (SDK " + Build.VERSION.SDK_INT + ")")
      appendLine("abis: " + Build.SUPPORTED_ABIS.joinToString(", "))
      appendLine("page size: " + pageSize)
      appendLine()
      append(stack)
    }
  }

  // /proc/self/cmdline 은 "com.gongmoa.app:crash" 처럼 프로세스 이름을 그대로 담는다.
  // 뒤에 NUL 패딩이 붙어 있어 잘라낸다. API 버전 분기가 필요 없는 방법이라 이걸 쓴다.
  private fun processName(): String = try {
    File("/proc/self/cmdline").readText().trim { it <= ' ' }
  } catch (ignored: Throwable) {
    ""
  }
}
`;

const CRASH_ACTIVITY_KT = `package %%PACKAGE%%

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import kotlin.system.exitProcess

// 죽은 이유를 그대로 보여주는 화면. RN 을 쓰지 않는다 — RN 이 못 뜨는 상황을 보여주는
// 화면이라 RN 에 의존하면 안 된다. 별도 프로세스(:crash)에서 돈다.
class CrashReportActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    val text = intent?.getStringExtra(CrashReport.EXTRA_TEXT)
      ?: CrashReport.consume(this)
      ?: "기록된 오류가 없습니다."

    val pad = (16 * resources.displayMetrics.density).toInt()

    val title = TextView(this).apply {
      setText("앱이 시작하지 못했습니다")
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
      setTypeface(typeface, Typeface.BOLD)
      setTextColor(Color.parseColor("#111827"))
    }

    val hint = TextView(this).apply {
      setText("아래 내용이 원인입니다. 화면을 캡처하거나 [복사] 후 전달해 주세요.")
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
      setTextColor(Color.parseColor("#4b5563"))
      setPadding(0, pad / 2, 0, pad / 2)
    }

    val body = TextView(this).apply {
      setText(text)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
      setTypeface(Typeface.MONOSPACE)
      setTextColor(Color.parseColor("#111827"))
      setTextIsSelectable(true)
    }

    val scroll = ScrollView(this).apply {
      addView(body)
      layoutParams = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        0,
      ).apply { weight = 1f }
    }

    val copy = Button(this).apply {
      setText("복사")
      setOnClickListener {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("crash", text))
        Toast.makeText(this@CrashReportActivity, "복사했습니다", Toast.LENGTH_SHORT).show()
      }
    }

    val close = Button(this).apply {
      setText("닫기")
      setOnClickListener {
        finish()
        exitProcess(0)
      }
    }

    val buttons = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.END
      addView(copy)
      addView(close)
    }

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(Color.WHITE)
      setPadding(pad, pad, pad, pad)
      addView(title)
      addView(hint)
      addView(scroll)
      addView(buttons)
    }

    setContentView(root)
  }
}
`;

// MainApplication.onCreate 안의 초기화를 try/catch 로 감싼다. 여기서 죽으면 액티비티가
// 아예 안 뜨기 때문에, 죽는 대신 기록만 남기고 넘어가 MainActivity 가 보고 화면을 열게 한다.
function patchMainApplication(contents) {
  if (contents.includes("CrashReport")) return contents;

  const start = "    super.onCreate()\n    SoLoader.init(this, OpenSourceMergedSoMapping)";
  const startReplacement = [
    "    super.onCreate()",
    "    // 보고 화면 전용 프로세스에서는 RN 을 켜지 않는다(그 초기화가 죽는 원인일 수 있다).",
    "    if (CrashReport.isCrashProcess(this)) return",
    "    CrashReport.install(this)",
    "    try {",
    "    SoLoader.init(this, OpenSourceMergedSoMapping)",
  ].join("\n");

  const end = "    ApplicationLifecycleDispatcher.onApplicationCreate(this)\n  }";
  const endReplacement = [
    "    ApplicationLifecycleDispatcher.onApplicationCreate(this)",
    "    } catch (error: Throwable) {",
    "      // 여기서 그냥 죽으면 화면 없이 종료된다. 기록해 두고 MainActivity 가 보여준다.",
    "      CrashReport.save(this, error)",
    "    }",
    "  }",
  ].join("\n");

  if (!contents.includes(start) || !contents.includes(end)) {
    throw new Error(
      "with-crash-screen: MainApplication.kt 형태가 예상과 다릅니다. Expo 템플릿이 바뀐 것 같으니 플러그인을 갱신하세요.",
    );
  }

  return contents.replace(start, startReplacement).replace(end, endReplacement);
}

// 지난 실행이 남긴 보고서가 있으면 RN 을 띄우기 전에 보고 화면부터 연다.
function patchMainActivity(contents) {
  if (contents.includes("CrashReport")) return contents;

  const anchor = "    setTheme(R.style.AppTheme);\n    super.onCreate(null)";
  if (!contents.includes(anchor)) {
    throw new Error(
      "with-crash-screen: MainActivity.kt 형태가 예상과 다릅니다. Expo 템플릿이 바뀐 것 같으니 플러그인을 갱신하세요.",
    );
  }

  return contents.replace(
    anchor,
    [
      "    setTheme(R.style.AppTheme);",
      "    // 지난 실행이 죽었다면 원인부터 보여준다. 보고 화면은 다른 프로세스라",
      "    // 이 프로세스가 또 죽어도 화면은 남는다.",
      "    if (CrashReport.hasReport(this)) {",
      "      CrashReport.show(this)",
      "      finish()",
      "    }",
      "    super.onCreate(null)",
    ].join("\n"),
  );
}

const withCrashScreen = (config) => {
  config = withDangerousMod(config, [
    "android",
    async (mod) => {
      const packageName = mod.android?.package;
      if (!packageName) throw new Error("with-crash-screen: android.package 가 없습니다.");

      const dir = path.join(
        mod.modRequest.platformProjectRoot,
        "app/src/main/java",
        ...packageName.split("."),
      );
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "CrashReport.kt"),
        CRASH_REPORT_KT.replace("%%PACKAGE%%", packageName),
      );
      fs.writeFileSync(
        path.join(dir, "CrashReportActivity.kt"),
        CRASH_ACTIVITY_KT.replace("%%PACKAGE%%", packageName),
      );
      return mod;
    },
  ]);

  config = withMainApplication(config, (mod) => {
    mod.modResults.contents = patchMainApplication(mod.modResults.contents);
    return mod;
  });

  config = withMainActivity(config, (mod) => {
    mod.modResults.contents = patchMainActivity(mod.modResults.contents);
    return mod;
  });

  config = withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0];
    if (!application) throw new Error("with-crash-screen: <application> 을 찾지 못했습니다.");
    application.activity = application.activity ?? [];

    const name = ".CrashReportActivity";
    if (!application.activity.some((it) => it.$?.["android:name"] === name)) {
      application.activity.push({
        $: {
          "android:name": name,
          // 앱 프로세스가 죽어도 이 화면은 살아 있어야 한다.
          "android:process": ":crash",
          "android:exported": "false",
          "android:launchMode": "singleTask",
          "android:excludeFromRecents": "true",
          "android:theme": "@android:style/Theme.DeviceDefault.Light",
        },
      });
    }
    return mod;
  });

  return config;
};

module.exports = withCrashScreen;
