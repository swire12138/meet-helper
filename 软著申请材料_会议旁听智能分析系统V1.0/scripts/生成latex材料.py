from __future__ import annotations

from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
GENERATED = ROOT / "generated"
PAGE_SEPARATOR = "=" * 80


def escape_tex(text: str) -> str:
    replacements = {
        "\\": r"\textbackslash{}",
        "&": r"\&",
        "%": r"\%",
        "$": r"\$",
        "#": r"\#",
        "_": r"\_",
        "{": r"\{",
        "}": r"\}",
        "~": r"\textasciitilde{}",
        "^": r"\textasciicircum{}",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return text


def split_page_header(header_line: str) -> tuple[str, int | None]:
    match = re.match(r"^(.*?)(?:\s+Page\s+(\d+))\s*$", header_line)
    if not match:
        return header_line, None
    return match.group(1).rstrip(), int(match.group(2))


def read_paged_text(src: Path) -> list[dict[str, object]]:
    lines = src.read_text(encoding="utf-8-sig").splitlines()
    pages: list[list[str]] = []
    current: list[str] = []
    for line in lines:
        sanitized = line.replace("\t", "    ")
        if sanitized == PAGE_SEPARATOR:
            pages.append(current)
            current = []
            continue
        current.append(sanitized)
    if current:
        pages.append(current)

    result: list[dict[str, object]] = []
    for raw_page in pages:
        if raw_page:
            header_text, source_page_no = split_page_header(raw_page[0])
            body_lines = raw_page[1:]
        else:
            header_text, source_page_no = "", None
            body_lines = []
        result.append(
            {
                "header_text": header_text,
                "source_page_no": source_page_no,
                "body_lines": body_lines,
            }
        )
    return result


def render_page_block(lines: list[str], font_size: str) -> str:
    body = "\n".join(lines)
    return rf"""\begin{{Verbatim}}[fontsize={font_size}]
{body}
\end{{Verbatim}}"""


def render_document_page_block(lines: list[str]) -> str:
    rendered: list[str] = []
    paragraph_buffer: list[str] = []
    list_buffer: list[str] = []
    enum_buffer: list[str] = []

    def parse_numbered_items(text: str) -> list[str]:
        matches = re.findall(r"(?:^|\s)(\d+)\.\s*(.*?)(?=(?:\s+\d+\.\s)|$)", text)
        items = [item.strip().rstrip("；;") for _, item in matches if item.strip()]
        return items

    def flush_paragraph() -> None:
        nonlocal paragraph_buffer
        if not paragraph_buffer:
            return
        paragraph_text = " ".join(part.strip() for part in paragraph_buffer if part.strip())
        if paragraph_text:
            rendered.append(rf"{escape_tex(paragraph_text)}\par")
        paragraph_buffer = []

    def flush_list() -> None:
        nonlocal list_buffer
        if not list_buffer:
            return
        rendered.append(r"\begin{itemize}")
        for item in list_buffer:
            rendered.append(rf"\item {escape_tex(item)}")
        rendered.append(r"\end{itemize}")
        list_buffer = []

    def flush_enum() -> None:
        nonlocal enum_buffer
        if not enum_buffer:
            return
        rendered.append(r"\begin{enumerate}")
        for item in enum_buffer:
            rendered.append(rf"\item {escape_tex(item)}")
        rendered.append(r"\end{enumerate}")
        enum_buffer = []

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            flush_paragraph()
            flush_list()
            flush_enum()
            rendered.append(r"\vspace{0.45em}")
            continue
        if line.startswith("# "):
            flush_paragraph()
            flush_list()
            flush_enum()
            rendered.append(rf"\begin{{center}}\LARGE\bfseries {escape_tex(line[2:].strip())}\par\end{{center}}")
            continue
        if line.startswith("## "):
            flush_paragraph()
            flush_list()
            flush_enum()
            rendered.append(rf"\section*{{{escape_tex(line[3:].strip())}}}")
            continue
        if line.startswith("### "):
            flush_paragraph()
            flush_list()
            flush_enum()
            rendered.append(rf"\subsection*{{{escape_tex(line[4:].strip())}}}")
            continue
        if line.startswith("- "):
            flush_paragraph()
            flush_enum()
            list_buffer.append(line[2:].strip())
            continue
        numbered_items = parse_numbered_items(line)
        if numbered_items and (len(numbered_items) >= 2 or re.match(r"^\d+\.\s+", line)):
            flush_paragraph()
            flush_list()
            enum_buffer.extend(numbered_items)
            continue
        flush_list()
        flush_enum()
        paragraph_buffer.append(line)

    flush_paragraph()
    flush_list()
    flush_enum()
    return "\n".join(rendered)


def build_tex(title: str, subtitle: str, pages: list[dict[str, object]], render_mode: str) -> str:
    line_count = max((len(page["body_lines"]) for page in pages), default=0)
    if line_count <= 32:
        font_size = r"\normalsize"
    elif line_count <= 40:
        font_size = r"\small"
    else:
        font_size = r"\footnotesize"

    header_text = str(pages[0]["header_text"]) if pages else escape_tex(title)
    page_blocks = []
    for index, page in enumerate(pages):
        body_lines = list(page["body_lines"])
        page_blocks.append(rf"\fancyhead[L]{{{escape_tex(header_text)}}}")
        page_blocks.append(r"\fancyhead[R]{}")
        if render_mode == "document":
            page_blocks.append(render_document_page_block(body_lines))
        else:
            page_blocks.append(render_page_block(body_lines, font_size))
        if index != len(pages) - 1:
            page_blocks.append(r"\newpage")
    content = "\n".join(page_blocks)

    return rf"""\documentclass[12pt,a4paper]{{article}}
\usepackage[a4paper,left=2.1cm,right=2.1cm,top=1.7cm,bottom=1.7cm,includeheadfoot,headheight=15pt,headsep=10pt,footskip=16pt]{{geometry}}
\usepackage{{fancyhdr}}
\usepackage{{fancyvrb}}
\usepackage{{hyperref}}
\usepackage{{xcolor}}
\usepackage{{fontspec}}
\XeTeXlinebreaklocale "zh"
\XeTeXlinebreakskip = 0pt plus 1pt
\emergencystretch = 2em
\IfFontExistsTF{{Microsoft YaHei UI}}{{%
  \setmainfont{{Microsoft YaHei UI}}
  \setsansfont{{Microsoft YaHei UI}}
  \setmonofont{{Microsoft YaHei UI}}
}}{{%
  \IfFontExistsTF{{Noto Serif SC}}{{%
    \setmainfont{{Noto Serif SC}}
    \setsansfont{{Noto Serif SC}}
    \setmonofont{{Noto Serif SC}}
  }}{{%
    \setmainfont{{Arial}}
    \setsansfont{{Arial}}
    \setmonofont{{Courier New}}
  }}
}}
\pagestyle{{fancy}}
\fancyhf{{}}
\fancyfoot[C]{{Page \thepage}}
\renewcommand{{\headrulewidth}}{{0.4pt}}
\renewcommand{{\footrulewidth}}{{0.4pt}}
\setlength{{\parindent}}{{0pt}}
\raggedbottom
\begin{{document}}
{content}
\end{{document}}
"""


def main() -> None:
    targets = [
        (
            GENERATED / "software_copyright_program_material.txt",
            GENERATED / "software_copyright_program_material.tex",
            "会议旁听智能分析系统 V1.0",
            "程序鉴别材料",
            "program",
        ),
        (
            GENERATED / "software_copyright_document_material.txt",
            GENERATED / "software_copyright_document_material.tex",
            "会议旁听智能分析系统 V1.0",
            "文档鉴别材料",
            "document",
        ),
    ]

    for src, dst, title, subtitle, render_mode in targets:
        pages = read_paged_text(src)
        dst.write_text(build_tex(title, subtitle, pages, render_mode), encoding="utf-8")
        print(f"generated: {dst}")


if __name__ == "__main__":
    main()
