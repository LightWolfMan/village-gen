#!/usr/bin/env python3
"""Acompanhe o mapa do projeto do Claude do Alisson (branch mapa-ao-vivo). Precisa só de Python 3 e git com acesso ao
repositório. Uso:  python seguir.py   (abre o mapa no navegador e atualiza a cada ~15 s; Ctrl+C sai)
Cria a pasta ./kikiu-mapa; não mexe no seu clone do jogo."""
import os, subprocess, sys, time, webbrowser
URL = "https://github.com/brenoalmeidatec/KIKIU-Survival.git"
PASTA = os.path.join(os.getcwd(), "kikiu-mapa")
BRANCH = "mapa-ao-vivo"


def git(*a, cwd=None):
    return subprocess.run(["git", *a], cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")


if not os.path.isdir(os.path.join(PASTA, ".git")):
    print("baixando o mapa (1ª vez)...")
    r = git("clone", "--quiet", "--depth", "1", "--branch", BRANCH, "--single-branch", URL, PASTA)
    if r.returncode != 0:
        sys.exit("não consegui baixar: " + (r.stderr or r.stdout)[:300])
webbrowser.open("file:///" + os.path.join(PASTA, "mapa.html").replace("\\", "/"))
print("mapa aberto. Atualizando a cada 15 s (Ctrl+C para sair).")
while True:
    try:
        git("fetch", "--quiet", "--depth", "1", "origin", BRANCH, cwd=PASTA)
        git("reset", "--quiet", "--hard", "FETCH_HEAD", cwd=PASTA)
        time.sleep(15)
    except KeyboardInterrupt:
        break
