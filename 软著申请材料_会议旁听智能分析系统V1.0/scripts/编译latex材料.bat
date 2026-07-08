@echo off
setlocal
cd /d "%~dp0..\generated"
xelatex -interaction=nonstopmode software_copyright_program_material.tex
xelatex -interaction=nonstopmode software_copyright_program_material.tex
xelatex -interaction=nonstopmode software_copyright_document_material.tex
xelatex -interaction=nonstopmode software_copyright_document_material.tex
endlocal
