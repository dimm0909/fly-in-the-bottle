DOCSDIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
REPOROOT := $(abspath $(DOCSDIR)/..)
VENV_SPHINX := $(REPOROOT)/.venv/bin/sphinx-build

ifndef SPHINXBUILD
ifneq ($(wildcard $(VENV_SPHINX)),)
SPHINXBUILD := $(VENV_SPHINX)
else ifneq ($(shell command -v sphinx-build 2>/dev/null),)
SPHINXBUILD := sphinx-build
else
$(error sphinx-build не найден. Установите зависимости: python3 -m venv --system-site-packages .venv && .venv/bin/pip install -r docs/requirements.txt)
endif
endif

SOURCEDIR := $(DOCSDIR)
BUILDDIR := $(DOCSDIR)/_build
AUTOSUMMARYDIR := $(DOCSDIR)/api/generated

.PHONY: html clean

# Всегда полная пересборка: боковое меню и дерево страниц не должны расходиться
# между HTML-файлами после инкрементальных правок toctree.
html: clean
	$(SPHINXBUILD) -b html -E $(SOURCEDIR) $(BUILDDIR)/html

clean:
	rm -rf $(BUILDDIR) $(AUTOSUMMARYDIR)
