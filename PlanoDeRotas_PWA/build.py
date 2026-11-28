#!/usr/bin/env python3
"""Plano de Rotas — prepara uma nova versão para publicar.

Edite SEMPRE app.src.js (código legível). Depois corra:   python3 build.py
Isto:
  1. lê APP_BUILD de app.src.js
  2. cria app.min.js (minificado com esbuild; se o esbuild não existir, copia sem minificar)
  3. escreve version.json  -> o aviso "Nova versão disponível" nos telemóveis
  4. atualiza index.html (app.min.js?v=…, tailwind.css?v=…) e sw.js (APP_BUILD, lista SHELL)
Depois publique no GitHub: index.html, app.min.js, app.src.js, version.json, sw.js
(e tailwind.css / imagens só se mudaram).
"""
import json, os, re, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
p = lambda n: os.path.join(HERE, n)
read = lambda n: open(p(n), encoding="utf-8").read()
def write(n, s):
    with open(p(n), "w", encoding="utf-8", newline="\n") as f:
        f.write(s)

src = read("app.src.js")
m = re.search(r'const APP_BUILD = "([^"]+)"', src)
if not m:
    sys.exit("APP_BUILD não encontrado em app.src.js")
build = m.group(1)

# 1) minify
esbuild = shutil.which("esbuild") or next((x for x in ["/opt/npm-tools/node_modules/.bin/esbuild",
    "/opt/npm-tools/node_modules/esbuild/bin/esbuild"] if os.path.exists(x)), None)
cmd = [esbuild] if esbuild else (["npx", "--yes", "esbuild"] if shutil.which("npx") else None)
ok = False
if cmd:
    r = subprocess.run(cmd + [p("app.src.js"), "--minify", "--charset=utf8", "--legal-comments=none",
                       "--outfile=" + p("app.min.js")], capture_output=True, text=True)
    ok = r.returncode == 0
    if not ok:
        print(r.stderr)
if not ok:
    print("AVISO: esbuild indisponível — app.min.js fica igual a app.src.js (funciona, só é maior).")
    shutil.copyfile(p("app.src.js"), p("app.min.js"))

# 2) version.json
write("version.json", json.dumps({"build": build}) + "\n")

# 3) index.html + sw.js
html = read("index.html")
html, n = re.subn(r'app\.min\.js\?v=[^"\n]*', "app.min.js?v=" + build, html)
if n != 1:
    sys.exit("index.html: referência a app.min.js não encontrada")
html = re.sub(r'const APP_BUILD = "[^"]*"', 'const APP_BUILD = "%s"' % build, html)
cssv = re.search(r'tailwind\.css\?v=([^"]+)', html).group(1)
write("index.html", html)

sw = read("sw.js")
sw = re.sub(r'const APP_BUILD = "[^"]*";', 'const APP_BUILD = "%s";' % build, sw)
sw = re.sub(r'"\./app\.min\.js\?v=[^"\n]*"', '"./app.min.js?v=%s"' % build, sw)
sw = re.sub(r'"\./tailwind\.css\?v=[^"\n]*"', '"./tailwind.css?v=%s"' % cssv, sw)
write("sw.js", sw)

kb = lambda n: round(os.path.getsize(p(n)) / 1024)
print(f"Versão {build}: app.src.js {kb('app.src.js')} KB -> app.min.js {kb('app.min.js')} KB")
