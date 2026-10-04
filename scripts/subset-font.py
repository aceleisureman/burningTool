#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
字体子集化：把 renderer/fonts 下的阿里妈妈方圆体裁剪为只包含界面实际用到的字符。

背景：完整字体 7017 字形 / 2.4MB，占 renderer/dist 体积的 ~75%。
界面里出现的字符是有限的（中文标签 + ASCII + 常见标点），子集化后通常可降到百 KB 级。

用法：
    python scripts/subset-font.py

依赖：fonttools（+ brotli 用于 woff2）
    pip install fonttools brotli

脚本会：
1. 扫描 renderer/src、renderer/index.html 及主进程里可能显示给用户的字符串，收集字符集；
2. 保底并入 ASCII、CJK 常用标点、以及《通用规范汉字表》里界面常见字的安全余量；
3. 用 pyftsubset 输出到 renderer/fonts/，保持同名覆盖（源文件另存 .full.woff2 备份一次）。
"""
import os
import re
import sys
import shutil
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS_DIR = os.path.join(ROOT, "renderer", "fonts")
SRC_FONT = os.path.join(FONTS_DIR, "AlimamaFangYuanTiVF-Thin.woff2")
OUT_FONT = SRC_FONT  # 原地覆盖
BACKUP = os.path.join(FONTS_DIR, "AlimamaFangYuanTiVF-Thin.full.woff2")

# 需要扫描的源（递归目录或单文件）
SCAN_TARGETS = [
    os.path.join(ROOT, "renderer", "src"),
    os.path.join(ROOT, "renderer", "index.html"),
    os.path.join(ROOT, "packages", "flash-core"),
    os.path.join(ROOT, "src", "main"),
]
SCAN_EXT = {".vue", ".js", ".mjs", ".ts", ".html", ".css"}

# 保底字符：ASCII 可见字符 + 常见中英文标点 + 各种符号
BASE_CHARS = set(
    "".join(chr(c) for c in range(0x20, 0x7F))  # ASCII 可见
) | set(
    "　、。〃々〈〉《》「」『』【】〔〕〖〗！＂＃＄％＆＇（）＊＋，－．／：；＜＝＞？＠［＼］＾＿｀｛｜｝～"
    "·—–…‘’“”«»‹›°±×÷≈≠≤≥∞√∫∑∏µΩπΔ±→←↑↓↔⇒⇔"
    "①②③④⑤⑥⑦⑧⑨⑩"
    "─│┌┐└┘├┤┬┴┼━┃┏┓┗┛┣┫┳┻╋"
    "✓✔✕✖✗✘★☆●○◆◇■□▲▼◀▶♦·"
    "⺀⺁⺂⺃⺄⺅⺆⺇⺈⺉⺊⺋⺌⺍⺎⺏⺐⺑⺒⺓⺔⺕⺖⺗⺘⺙⺚⺛⺜⺝⺞⺟⺠⺡⺢⺣⺤⺥⺦⺧⺨⺩⺪⺫⺬⺭⺮⺯⺰⺱⺲⺳⺴⺵⺶⺷⺸⺹⺺⺻⺼⺽⺾⺿⻀⻁⻂⻃⻄⻅⻆⻇⻈⻉⻊⻋⻌⻍⻎⻏⻐⻑⻒⻓⻔⻕⻖⻗⻘⻙⻚⻛⻜⻝⻞⻟⻠⻡⻢⻣⻤⻥⻦⻧⻨⻩⻪⻫⻬⻭⻮⻯⻰⻱⻲⻳"
)

# 安全余量：界面之外仍可能被动态拼接/错误信息/文件名带出的高频汉字。
# 覆盖《通用规范汉字表》一级字（3500）会导致体积回升，这里取常见的一批兜底。
SAFETY_CJK = (
    "的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动"
    "同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自"
    "二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日"
    "那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变"
    "条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总"
    "次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指"
    "几九区强放决西被干做必战先回则任取据处队南给色光门即保治北造百规热领七海口东导器"
    "压志世金增争济阶油思术极交受联什认六共权收证改清己美再采转更单风切打白教速花带安"
    "场身车例真务具万每目至达走积示议声报斗完类八离华名确才科张信马节话米整空元况今集"
    "温传土许步群广石记需段研界拉林律叫且究观越织装影算低持音众书布复容儿须际商非验连"
    "断深难近矿千周委素技备半办青省列习响约支般史感劳便团往酸历市克何除消构府称太准精"
    "值号率族维划选标写存候毛亲快效斯院查江型眼王按格养易置派层片始却专状育厂京识适属"
    "圆包火住调满县局照参红细引听该铁价严龙飞编译烧录调试串口固件芯片工具设置端口连接"
    "波特率奇偶校验数据位停止位发送接收清空暂停恢复日志内存地址长度读取写入校验错误成功"
    "失败等待重试取消确认提示警告信息文件路径目录选择刷新下载安装卸载版本更新检查网络"
    "镜像官方源回退校验和不一致已完成进度正在准备初始化加载中请稍候未知无数据为空有效"
    "生成预览阈值偏移字模点阵宽度高度字库编码转换分析解析格式示例说明帮助关于退出最小化"
    "最大化关闭窗口主题浅色深色跟随系统语言字体缩放快捷键菜单工具栏侧边状态栏标题栏"
)

# CJK 标点与全角符号范围（直接并入，避免遗漏）
CJK_PUNCT_RANGES = [
    (0x3000, 0x303F),  # CJK 符号与标点
    (0xFF00, 0xFFEF),  # 全角
]


def collect_chars():
    chars = set(BASE_CHARS)
    chars |= set(SAFETY_CJK)
    for lo, hi in CJK_PUNCT_RANGES:
        for c in range(lo, hi + 1):
            chars.add(chr(c))

    scanned = 0
    for target in SCAN_TARGETS:
        if os.path.isfile(target):
            files = [target]
        elif os.path.isdir(target):
            files = []
            for dirpath, _dirs, names in os.walk(target):
                if "node_modules" in dirpath or "dist" in dirpath or "vendor" in dirpath:
                    continue
                for n in names:
                    if os.path.splitext(n)[1].lower() in SCAN_EXT:
                        files.append(os.path.join(dirpath, n))
        else:
            continue
        for fp in files:
            try:
                with open(fp, "r", encoding="utf-8", errors="ignore") as fh:
                    text = fh.read()
            except OSError:
                continue
            scanned += 1
            for ch in text:
                o = ord(ch)
                # 只保留可打印字符，跳过控制字符
                if o >= 0x20 and ch not in "\u200b\ufeff":
                    chars.add(ch)
    return chars, scanned


def main():
    if not os.path.exists(SRC_FONT):
        print("找不到字体文件:", SRC_FONT)
        return 1

    if not os.path.exists(BACKUP):
        shutil.copy2(SRC_FONT, BACKUP)
        print("已备份原字体 ->", BACKUP)

    chars, scanned = collect_chars()
    print("扫描文件数:", scanned, "收集字符数:", len(chars))

    # 写出字符集，供 pyftsubset --text-file 使用
    text_path = os.path.join(FONTS_DIR, "_subset_chars.txt")
    with open(text_path, "w", encoding="utf-8") as fh:
        fh.write("".join(sorted(chars)))

    before = os.path.getsize(SRC_FONT)
    cmd = [
        sys.executable, "-m", "fontTools.subset",
        BACKUP,
        "--text-file=" + text_path,
        "--flavor=woff2",
        "--layout-features=*",       # 保留字距/连字等排版特性
        "--no-hinting",              # 桌面端渲染不需要 hinting，显著减小
        "--desubroutinize",
        "--drop-tables+=BEVL",       # 丢弃未使用的 BEVL 可变轴
        "--name-IDs=*",
        "--recalc-bounds",
        "--output-file=" + OUT_FONT,
    ]
    print("执行:", " ".join(cmd))
    r = subprocess.run(cmd)
    if r.returncode != 0:
        print("子集化失败，保留原字体")
        return r.returncode

    after = os.path.getsize(OUT_FONT)
    pct = (1 - after / before) * 100 if before else 0
    print("完成：%d -> %d 字节（-%.1f%%）" % (before, after, pct))
    try:
        os.remove(text_path)
    except OSError:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
