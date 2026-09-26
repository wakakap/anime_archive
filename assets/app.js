// 共通ヘルパ。外部ライブラリは使わない —— GitHub Pages に置いたとき
// 依存が切れて壊れるのが一番つまらないので。
"use strict";

const AD = {
  async json(path) {
    const r = await fetch(path, { cache: "no-cache" });
    if (!r.ok) throw new Error(path + " → " + r.status);
    return r.json();
  },

  /** 1234567 → "123.4万"。日本語圏の桁感覚に合わせる。 */
  man(n) {
    if (n == null) return "—";
    n = Number(n);
    if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + "億";
    if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(n >= 1e6 ? 0 : 1) + "万";
    return n.toLocaleString("ja-JP");
  },

  int(n) { return n == null ? "—" : Number(n).toLocaleString("ja-JP"); },

  signed(n) {
    if (n == null) return '<span class="dim">—</span>';
    const c = n > 0 ? "up" : (n < 0 ? "down" : "dim");
    const s = n > 0 ? "+" : "";
    return `<span class="${c}">${s}${AD.man(n)}</span>`;
  },

  esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  },

  /**
   * インラインのスパークライン。話ごとの視聴数の落ち方が一目で分かる。
   * 折れ線ではなく棒にしているのは、話数が飛び飛びでも誤解しにくいから。
   */
  spark(values, w, h) {
    w = w || 84; h = h || 20;
    const v = (values || []).filter((x) => x != null);
    if (v.length < 2) return "";
    const max = Math.max.apply(null, v) || 1;
    const bw = w / v.length;
    const bars = v.map((x, i) => {
      const bh = Math.max(1, (x / max) * (h - 2));
      return `<rect x="${(i * bw).toFixed(2)}" y="${(h - bh).toFixed(2)}"
        width="${Math.max(1, bw - 1).toFixed(2)}" height="${bh.toFixed(2)}" rx="0.5"/>`;
    }).join("");
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"
      fill="url(#sparkGrad)" aria-hidden="true">${bars}</svg>`;
  },

  /**
   * 順位の推移。視聴数のスパークラインと違って**上下が逆** ——
   * 1 位が一番上。折れ線にしないと「上がった／下がった」が直感に合わない。
   */
  rankSpark(ranks, maxRank, w, h) {
    w = w || 70; h = h || 18;
    const v = (ranks || []).filter((x) => x != null);
    if (v.length < 2) return "";
    const mx = maxRank || Math.max.apply(null, v) || 1;
    const x = (i) => (v.length === 1 ? w / 2 : (i / (v.length - 1)) * (w - 4) + 2);
    const y = (r) => ((r - 1) / Math.max(1, mx - 1)) * (h - 6) + 3;
    const pts = v.map((r, i) => `${x(i).toFixed(1)},${y(r).toFixed(1)}`).join(" ");
    const end = v[v.length - 1];
    const col = end < v[0] ? "#9ece6a" : (end > v[0] ? "#f7768e" : "#7a8195");
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
      <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.5"
        stroke-linejoin="round" stroke-linecap="round" opacity=".85"/>
      <circle cx="${x(v.length - 1).toFixed(1)}" cy="${y(end).toFixed(1)}" r="2" fill="${col}"/>
    </svg>`;
  },

  /** ▲3 / ▼2 / NEW / — */
  move(m, prev) {
    if (prev == null) return '<span class="pill" style="color:var(--amber)">NEW</span>';
    if (m == null || m === 0) return '<span class="dim">—</span>';
    return m > 0 ? `<span class="up">▲${m}</span>` : `<span class="down">▼${-m}</span>`;
  },

  /** グラデーションの定義。ページに一度だけ差し込む。 */
  defs() {
    return `<svg width="0" height="0" style="position:absolute"><defs>
      <linearGradient id="sparkGrad" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stop-color="#3d4a7a"/><stop offset="100%" stop-color="#7aa2f7"/>
      </linearGradient>
      <linearGradient id="barGrad" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stop-color="#2b3560"/><stop offset="100%" stop-color="#7aa2f7"/>
      </linearGradient>
    </defs></svg>`;
  },

  /**
   * 棒グラフ。話数 × 視聴数。
   * ライブラリを入れれば速いが、この 40 行で足りるものに 200KB は払わない。
   */
  /* ---- 時間変化の折れ線 ----------------------------------------------
   *
   * 系列が 60 本を超えることがあるので、**色は上位 8 本だけ**に割り当てる。
   * 9 本目に新しい色を作らない —— 作ったところで見分けが付かないし、
   * 色覚の検証も通らなくなる。残りは薄い灰色の地として敷き、形だけ見せる。
   * 色は順位ではなく**作品**に付く（並べ替えても塗り替えない）。
   *
   * 名前は線の右端に直接置く。凡例だけだと 8 本でも目が往復する。
   * 長い題名は 4 文字で切る（利用者の指定）。全体は hover の吹き出しで出す。
   *
   * palette は dataviz の既定 8 色（暗い面用の段）。
   * node scripts/validate_palette.js で全項目 PASS を確認済み
   * （面 #0e1018、最悪の隣接 CVD ΔE 8.4 / 通常視 19.3）。
   */
  SERIES: ["#3987e5", "#d95926", "#199e70", "#c98500",
           "#d55181", "#008300", "#9085e9", "#e66767"],

  cut(s2, n) {
    s2 = String(s2 || "");
    return s2.length > n ? s2.slice(0, n) + "…" : s2;
  },

  lineChart(series, opts) {
    const o = Object.assign({
      w: 860, h: 300, pad: 34, right: 96, invert: false,
      fmt: (v) => AD.int(v), label: 4, topN: 8,
    }, opts || {});
    const live = series.filter((s2) => (s2.points || []).length);
    if (live.length < 1) return "";

    const days = [...new Set(live.flatMap((s2) => s2.points.map((p) => p.d)))].sort();
    if (days.length < 2) {
      return `<div class="empty" style="padding:22px 16px">
        観測が ${days.length} 日ぶんしか無いので線が引けない。
        もう一度採集すると描けるようになる。</div>`;
    }

    const vals = live.flatMap((s2) => s2.points.map((p) => p.v));
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (lo === hi) { lo -= 1; hi += 1; }
    const padV = (hi - lo) * 0.08;
    lo -= padV; hi += padV;
    // **軸が有り得ない値に伸びないようにする。** 余白を付けただけで
    // 視聴数の軸に「-42.2万」、順位の軸に「-1 位」が出ていた。
    // 存在しない目盛りは、読む側に「そこまで下がりうる」と思わせる。
    if (o.floor != null) lo = Math.max(lo, o.floor);
    if (o.ceil != null) hi = Math.min(hi, o.ceil);

    const x = (d) => o.pad + (days.indexOf(d) / (days.length - 1)) * (o.w - o.pad - o.right);
    const y = (v) => {
      const t = (v - lo) / (hi - lo);
      return o.invert ? o.pad + t * (o.h - o.pad * 2) : (o.h - o.pad) - t * (o.h - o.pad * 2);
    };

    const top = live.slice(0, o.topN);
    const rest = live.slice(o.topN);

    const path = (s2) => s2.points.map((p, i) =>
      `${i ? "L" : "M"}${x(p.d).toFixed(1)},${y(p.v).toFixed(1)}`).join("");

    // 地の線（色を持たない残り）。形の文脈だけ出す。
    const back = rest.map((s2) =>
      `<path d="${path(s2)}" fill="none" stroke="var(--text-mute)" stroke-opacity=".35"
         stroke-width="1"/>`).join("");

    // 端の名前は**重ならないように押しのける**。
    // 上位 8 本は終値が近いことが多く、素直に置くと 7 組中 5 組が重なった。
    // 線とラベルは細い引き出し線でつなぐ（離れると、どの線の名前か分からない）。
    const GAP = 12;
    const marks = top.map((s2, i) => {
      const last = s2.points[s2.points.length - 1];
      return { i, s2, c: AD.SERIES[i % AD.SERIES.length],
               lx: x(last.d), ly: y(last.v), ty: y(last.v) };
    }).sort((a, b) => a.ly - b.ly);
    for (let k = 1; k < marks.length; k++) {
      if (marks[k].ty - marks[k - 1].ty < GAP) marks[k].ty = marks[k - 1].ty + GAP;
    }
    // 下にはみ出したら、今度は上へ詰め直す
    const bottom = o.h - o.pad;
    if (marks.length && marks[marks.length - 1].ty > bottom) {
      marks[marks.length - 1].ty = bottom;
      for (let k = marks.length - 2; k >= 0; k--) {
        if (marks[k + 1].ty - marks[k].ty < GAP) marks[k].ty = marks[k + 1].ty - GAP;
      }
    }

    const front = marks.map((m) => {
      const { s2, c } = m;
      return `<g class="ln" data-i="${m.i}">
        <path d="${path(s2)}" fill="none" stroke="${c}" stroke-width="2"
              stroke-linejoin="round" stroke-linecap="round"/>
        ${s2.points.map((p) =>
          `<circle cx="${x(p.d).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.5"
             fill="${c}" stroke="var(--panel)" stroke-width="1.5"/>`).join("")}
        ${Math.abs(m.ty - m.ly) > 1.5
          ? `<path d="M${(m.lx + 3).toFixed(1)},${m.ly.toFixed(1)}
                L${(m.lx + 6).toFixed(1)},${m.ty.toFixed(1)}"
               fill="none" stroke="${c}" stroke-width="1" stroke-opacity=".5"/>`
          : ""}
        <text x="${(m.lx + 8).toFixed(1)}" y="${(m.ty + 3.5).toFixed(1)}"
              fill="${c}" font-size="10.5">${AD.esc(AD.cut(s2.name, o.label))}</text>
      </g>`;
    }).join("");

    const grid = [0, .25, .5, .75, 1].map((t) => {
      const v = lo + (hi - lo) * (o.invert ? t : 1 - t);
      const yy = o.pad + t * (o.h - o.pad * 2);
      return `<line x1="${o.pad}" x2="${o.w - o.right}" y1="${yy}" y2="${yy}"
                stroke="var(--line)" stroke-width="1"/>
        <text x="${o.pad - 6}" y="${yy + 3.5}" text-anchor="end" fill="var(--text-mute)"
              font-size="9.5">${AD.esc(o.fmt(v))}</text>`;
    }).join("");

    const xlab = days.map((d, i) => (i === 0 || i === days.length - 1 ||
        days.length <= 6 || i % Math.ceil(days.length / 6) === 0)
      ? `<text x="${x(d).toFixed(1)}" y="${o.h - o.pad + 15}" text-anchor="middle"
           fill="var(--text-mute)" font-size="9.5">${d.slice(5)}</text>` : "").join("");

    // 凡例。2 本以上なら必ず出す —— 色だけで見分けさせない。
    const legend = top.map((s2, i) =>
      `<span class="lg"><i style="background:${AD.SERIES[i % AD.SERIES.length]}"></i>${
        AD.esc(s2.name)}</span>`).join("")
      + (rest.length ? `<span class="lg"><i style="background:var(--text-mute)"></i>ほか ${
          rest.length} 件</span>` : "");

    return `<div class="lc">
      <svg viewBox="0 0 ${o.w} ${o.h}" preserveAspectRatio="xMidYMid meet" role="img">
        ${grid}${xlab}${back}${front}
      </svg>
      <div class="lg-row">${legend}</div>
    </div>`;
  },

  barChart(items, opts) {
    opts = opts || {};
    const W = opts.width || 880, H = opts.height || 230;
    const pad = { l: 54, r: 10, t: 12, b: 28 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    if (!items.length) return "";
    const max = Math.max.apply(null, items.map((d) => d.v)) || 1;
    const bw = iw / items.length;

    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const y = pad.t + ih - f * ih;
      return `<line class="gridline" x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}"/>
        <text class="tick" x="${pad.l - 8}" y="${y + 3}" text-anchor="end">${AD.man(max * f)}</text>`;
    }).join("");

    const bars = items.map((d, i) => {
      const bh = Math.max(1, (d.v / max) * ih);
      const x = pad.l + i * bw, y = pad.t + ih - bh;
      const lbl = (items.length <= 26 || i % 2 === 0)
        ? `<text class="tick" x="${x + bw / 2}" y="${H - 9}" text-anchor="middle">${AD.esc(d.k)}</text>`
        : "";
      return `<g><title>${AD.esc(d.t || d.k)} — ${AD.int(d.v)}</title>
        <rect x="${x + 1.5}" y="${y}" width="${Math.max(1, bw - 3)}" height="${bh}"
              rx="2" fill="url(#barGrad)"/></g>${lbl}`;
    }).join("");

    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      ${ticks}<line class="axis" x1="${pad.l}" y1="${pad.t + ih}" x2="${W - pad.r}" y2="${pad.t + ih}"/>
      ${bars}</svg>`;
  },

  /**
   * 雛形を読みやすく整える。JSON.stringify のままだと 1 行が長すぎて
   * 「どこを埋めるのか」が分からない。1 クール 1 行にする。
   */
  skeletonText(sk) {
    const plat = Object.keys(sk).find((k) => k !== "cours");
    const rows = (sk.cours || []).map(
      (c) => `    [${JSON.stringify(c[0])}, "", ` +
             `${c[2] == null ? "??" : c[2]}, ${c[3] == null ? "??" : c[3]}]`);
    return `{\n  ${JSON.stringify(plat)}: ${JSON.stringify(sk[plat])},\n` +
           `  "cours": [\n${rows.join(",\n")}\n  ]\n}`;
  },

  /** クリップボードへ。file:// では clipboard API が使えないので選択に落とす。 */
  async copy(text, el) {
    try {
      await navigator.clipboard.writeText(text);
      if (el) { const o = el.textContent; el.textContent = "コピーした"; 
                setTimeout(() => { el.textContent = o; }, 1400); }
      return true;
    } catch (_) {
      // file:// では clipboard API が無い。**画面に中身が出ているとは限らない**ので
      // （貼る用の塊はボタンだけにした）、見えない textarea を置いて execCommand で写す。
      // それも駄目なら、選べるものがあれば選択に落とす —— 黙って失敗するよりいい。
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (ok) {
          if (el) { const o = el.textContent; el.textContent = "コピーした";
                    setTimeout(() => { el.textContent = o; }, 1400); }
          return true;
        }
      } catch (_e) { /* 下の選択に落とす */ }
      const pre = el && el.closest(".panel") && el.closest(".panel").querySelector("pre");
      if (pre) {
        const r = document.createRange();
        r.selectNodeContents(pre);
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(r);
        if (el) { const o = el.textContent; el.textContent = "選択した（Ctrl+C）";
                  setTimeout(() => { el.textContent = o; }, 2000); }
      } else if (el) {
        const o = el.textContent; el.textContent = "コピーできない";
        setTimeout(() => { el.textContent = o; }, 2000);
      }
      return false;
    }
  },

  /**
   * 手元の受信器につながるか。
   *
   * サイトは 2 つの顔を持つ：GitHub Pages では読むだけ、手元では編集もできる。
   * 受信器がサイトごと配っているときは相対パスで届く。
   * preview.html を直接開いている場合は既定のポートを試す。
   */
  local: null,

  async probeLocal(port) {
    for (const base of ["", `http://127.0.0.1:${port || 8765}`]) {
      try {
        const c = new AbortController();
        const t = setTimeout(() => c.abort(), 1200);
        const r = await fetch(base + "/api/ping", { signal: c.signal });
        clearTimeout(t);
        if (r.ok) { AD.local = base; return base; }
      } catch (_) { /* 届かないのは普通のこと（公開版） */ }
    }
    AD.local = null;
    return null;
  },

  async api(path, body) {
    if (AD.local === null) throw new Error("手元の受信器につながっていない");
    const r = await fetch(AD.local + path, body === undefined ? {} : {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({ ok: false, error: "応答が JSON でない" }));
    if (!r.ok || !j.ok) throw new Error(j.error || ("HTTP " + r.status));
    return j;
  },

  /** プラットフォームのタブ。live 以外は押せないが、存在は見せる。 */
  platTabs(platforms, current, onPick) {
    const host = document.getElementById("plats");
    if (!host) return;
    host.innerHTML = "";
    platforms.forEach((p) => {
      const b = document.createElement("button");
      b.className = "plat";
      b.type = "button";
      b.disabled = p.status !== "live";
      b.setAttribute("aria-selected", String(p.id === current));
      b.innerHTML = `${AD.esc(p.name)}<span class="badge">${
        p.status === "live" ? (p.works ? p.works + "作品" : "LIVE")
          : p.status === "hold" ? "保留" : "未対応"}</span>`;   // hold：Disney+・巴哈姆特（押せない）
      b.title = p.note || "";
      if (p.status === "live") b.onclick = () => onPick(p.id);
      host.appendChild(b);
    });
  },
};
