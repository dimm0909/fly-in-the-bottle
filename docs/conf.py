from __future__ import annotations

import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
# tools/ содержит importable-модуль brain_client, который разбирается autodoc'ом.
sys.path.insert(0, str(ROOT_DIR / "tools"))

project = "Fly in the Bottle"
author = "fly-in-the-bottle contributors"

# Содержимое написано по-русски; это же задаёт html_search_language (Sphinx берёт его
# из `language`), так что поисковый индекс получает русский стеммер, а не английский.
language = "ru"

extensions = [
    "myst_parser",
    "sphinx.ext.autodoc",
    "sphinx.ext.autosummary",
    "sphinx.ext.napoleon",
    "sphinx.ext.viewcode",
    "sphinx_autodoc_typehints",
    "sphinxcontrib.mermaid",
]

source_suffix = {
    ".md": "markdown",
    ".rst": "restructuredtext",
}
root_doc = "index"
exclude_patterns = ["_build", "requirements.txt"]

autosummary_generate = True
autosummary_generate_overwrite = True
autoclass_content = "both"
autodoc_typehints = "description"
autodoc_default_options = {
    "members": True,
    "member-order": "bysource",
    "show-inheritance": True,
    "undoc-members": True,
}

napoleon_google_docstring = True
napoleon_numpy_docstring = True

myst_enable_extensions = ["colon_fence"]
myst_heading_anchors = 3
myst_fence_as_directive = ["mermaid"]

html_theme = "furo"
html_title = "Документация Fly in the Bottle"
html_static_path: list[str] = []
