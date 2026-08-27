/* Renders every Plotly chart on a league page from window.METRICS.
   One shared dark theme; 47-line charts use a neutral base + spotlight
   (identity comes from interaction, not 47 colours). */
(function () {
  "use strict";

  /* Standings "show all" toggle — runs regardless of chart data. */
  (function initShowAll() {
    function wire() {
      document.querySelectorAll(".show-all").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var t = document.getElementById(btn.dataset.target);
          if (!t) return;
          var collapsed = t.classList.toggle("standings-collapsed");
          btn.textContent = collapsed ? btn.dataset.more : btn.dataset.less;
        });
      });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
    else wire();
  })();

  var M = window.METRICS;
  if (!M || !M.meta || !M.meta.n_gws) return;
  var C = M.charts;

  var PAL = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#4ca64c", "#9085e9", "#e66767"];
  var INK = "#c3c2b7", MUTED = "#8a897e", GRID = "rgba(255,255,255,0.07)";
  var SURFACE = "#1a1a19", BORDER = "#33332f", DIM = "rgba(150,150,140,0.30)";
  var ACCENT = "#3987e5";
  var FONT = { family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', color: INK, size: 12 };
  var CONFIG = { displayModeBar: false, responsive: true };
  var GWS = C.bump.gws;

  function layout(over) {
    var base = {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: FONT,
      margin: { l: 60, r: 24, t: 8, b: 44 },
      hovermode: "closest",
      hoverlabel: { bgcolor: SURFACE, bordercolor: BORDER, font: { color: "#fff", family: FONT.family } },
      showlegend: false,
      xaxis: { gridcolor: GRID, zerolinecolor: GRID, linecolor: BORDER, tickfont: { color: MUTED } },
      yaxis: { gridcolor: GRID, zerolinecolor: GRID, linecolor: BORDER, tickfont: { color: MUTED } }
    };
    return Object.assign(base, over || {});
  }

  function esc(s) { return String(s).replace(/[<>&"]/g, function (c) {
    return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]; }); }

  // Spotlight <select>: option value stays the team name; label adds the manager.
  function fillSpotlight(id, series) {
    var el = document.getElementById(id);
    if (!el) return;
    var opts = series.slice().sort(function (a, b) { return a.name < b.name ? -1 : 1; });
    el.innerHTML = '<option value="">— none —</option>' + opts.map(function (s) {
      var label = s.real_name ? s.name + " — " + s.real_name : s.name;
      return '<option value="' + esc(s.name) + '">' + esc(label) + "</option>";
    }).join("");
  }

  function tallHeight(n) { return Math.max(320, n * 20 + 90); }
  function tall2(n) { return Math.max(340, n * 34 + 100); }  // room for 2-line manager labels

  /* ---------- position tracker (bump) --------------------------------- */
  var bumpState = { spot: "", byGroup: false };
  var groupColors = {};
  (function () {
    var gs = [];
    C.bump.series.forEach(function (s) { if (s.group && gs.indexOf(s.group) < 0) gs.push(s.group); });
    gs.sort().forEach(function (g, i) { groupColors[g] = PAL[i % PAL.length]; });
  })();

  function bumpStyle() {
    var colors = [], widths = [], opac = [];
    C.bump.series.forEach(function (s) {
      var isSpot = bumpState.spot && s.name === bumpState.spot;
      if (isSpot) { colors.push(ACCENT); widths.push(3.5); opac.push(1); }
      else if (bumpState.byGroup && s.group) { colors.push(groupColors[s.group]); widths.push(1.5); opac.push(bumpState.spot ? 0.25 : 0.75); }
      else { colors.push(DIM); widths.push(1); opac.push(bumpState.spot ? 0.35 : 1); }
    });
    Plotly.restyle("chart-bump", { "line.color": colors, "line.width": widths, "marker.color": colors, opacity: opac });
  }

  function renderBump() {
    var oneGw = GWS.length < 2;
    var traces = C.bump.series.map(function (s) {
      return {
        type: "scatter", mode: oneGw ? "markers" : "lines+markers", x: GWS, y: s.ranks, name: s.name,
        line: { color: DIM, width: 1, shape: "spline" },
        marker: { color: "rgba(165,165,155,0.55)", size: oneGw ? 7 : 4 },
        opacity: 1, connectgaps: false,
        hovertemplate: s.name + (s.real_name ? " · " + s.real_name : "") + " — rank %{y}<extra></extra>"
      };
    });
    var n = C.bump.series.length;
    Plotly.newPlot("chart-bump", traces, layout({
      height: tallHeight(Math.min(n, 24)),
      margin: { l: 44, r: 24, t: 8, b: 44 },
      xaxis: { title: "Gameweek", tickmode: "linear", dtick: 1, gridcolor: GRID, linecolor: BORDER, tickfont: { color: MUTED } },
      yaxis: { title: "League rank", autorange: "reversed", dtick: n > 20 ? 5 : 2, gridcolor: GRID, linecolor: BORDER, tickfont: { color: MUTED } }
    }), CONFIG);
    fillSpotlight("bump-spotlight", C.bump.series);
    var sp = document.getElementById("bump-spotlight");
    if (sp) sp.onchange = function (e) { bumpState.spot = e.target.value; bumpStyle(); };
    var gc = document.getElementById("bump-groupcolor");
    if (gc) gc.onchange = function () { bumpState.byGroup = gc.checked; bumpStyle(); };
  }

  /* ---------- title race -------------------------------------------- */
  var raceState = { mode: "totals", spot: "" };

  function raceStyle() {
    var colors = [], widths = [], opac = [];
    C.points_race.series.forEach(function (s) {
      var isSpot = raceState.spot && s.name === raceState.spot;
      colors.push(isSpot ? ACCENT : DIM);
      widths.push(isSpot ? 3.5 : 1);
      opac.push(raceState.spot ? (isSpot ? 1 : 0.35) : 1);
    });
    Plotly.restyle("chart-race", { "line.color": colors, "line.width": widths, "marker.color": colors, opacity: opac });
  }

  function renderRace() {
    var oneGw = GWS.length < 2;
    function traces(mode) {
      return C.points_race.series.map(function (s) {
        return {
          type: "scatter", mode: oneGw ? "markers" : "lines+markers", x: GWS, y: mode === "gap" ? s.gap : s.totals,
          name: s.name, line: { color: DIM, width: 1, shape: "spline" },
          marker: { color: "rgba(165,165,155,0.55)", size: oneGw ? 7 : 4 },
          connectgaps: false,
          hovertemplate: s.name + (s.real_name ? " · " + s.real_name : "") + " — %{y} " + (mode === "gap" ? "behind" : "pts") + "<extra></extra>"
        };
      });
    }
    Plotly.newPlot("chart-race", traces("totals"), layout({
      height: 460,
      xaxis: { title: "Gameweek", tickmode: "linear", dtick: 1, gridcolor: GRID, linecolor: BORDER, tickfont: { color: MUTED } },
      yaxis: { title: "Total points", gridcolor: GRID, linecolor: BORDER, tickfont: { color: MUTED } }
    }), CONFIG);
    fillSpotlight("race-spotlight", C.points_race.series);
    var md = document.getElementById("race-mode");
    if (md) md.onchange = function (e) {
      raceState.mode = e.target.value;
      var t = traces(raceState.mode);
      Plotly.react("chart-race", t, layout({
        height: 460,
        xaxis: { title: "Gameweek", tickmode: "linear", dtick: 1, gridcolor: GRID, linecolor: BORDER, tickfont: { color: MUTED } },
        yaxis: {
          title: raceState.mode === "gap" ? "Points behind leader" : "Total points",
          autorange: raceState.mode === "gap" ? "reversed" : true,
          gridcolor: GRID, linecolor: BORDER, tickfont: { color: MUTED }
        }
      }), CONFIG).then(raceStyle);
    };
    var sp = document.getElementById("race-spotlight");
    if (sp) sp.onchange = function (e) { raceState.spot = e.target.value; raceStyle(); };
  }

  /* ---------- horizontal bar helper -------------------------------- */
  function hbar(divId, names, values, opts) {
    opts = opts || {};
    var hoverNames = opts.raw || names;
    var trace = {
      type: "bar", orientation: "h",
      y: names, x: values, customdata: hoverNames,
      marker: { color: opts.colors || opts.color || ACCENT, line: { width: 0 } },
      text: values.map(function (v) { return opts.fmt ? opts.fmt(v) : v; }),
      textposition: "outside", textfont: { color: INK, size: 11 }, cliponaxis: false,
      hovertemplate: "%{customdata}: %{x}" + (opts.unit ? " " + opts.unit : "") + "<extra></extra>"
    };
    Plotly.newPlot(divId, [trace], layout({
      height: opts.height || tallHeight(names.length),
      margin: { l: opts.leftMargin || 150, r: 48, t: 8, b: 36 },
      bargap: 0.32,
      xaxis: { title: opts.xtitle || "", gridcolor: GRID, linecolor: BORDER, tickfont: { color: MUTED } },
      yaxis: { autorange: "reversed", tickfont: { color: INK, size: 11 }, automargin: true }
    }), CONFIG);
  }

  /* ---------- podium (stacked) ----------------------------------- */
  function renderPodium() {
    var p = C.podium;
    var N = (p.labels || p.managers).slice(0, 20);
    var raw = p.managers.slice(0, 20);
    var firsts = p.firsts.slice(0, 20), rest = p.podiums.slice(0, 20);
    Plotly.newPlot("chart-podium", [
      { type: "bar", orientation: "h", y: N, x: firsts, name: "1st place", marker: { color: PAL[0] },
        customdata: raw, hovertemplate: "%{customdata}: %{x}× 1st<extra></extra>" },
      { type: "bar", orientation: "h", y: N, x: rest, name: "2nd–3rd", marker: { color: PAL[1] },
        customdata: raw, hovertemplate: "%{customdata}: %{x}× 2nd–3rd<extra></extra>" }
    ], layout({
      barmode: "stack", bargap: 0.32, showlegend: true,
      legend: { orientation: "h", y: -0.12, font: { color: INK } },
      height: tall2(N.length),
      margin: { l: 190, r: 30, t: 8, b: 44 },
      xaxis: { title: "Gameweek top-3 finishes", dtick: 1, gridcolor: GRID, linecolor: BORDER, tickfont: { color: MUTED } },
      yaxis: { autorange: "reversed", tickfont: { color: INK, size: 11 }, automargin: true }
    }), CONFIG);
  }

  /* ---------- captaincy season favourites ----------------------- */
  function renderCaptaincy() {
    var s = C.captaincy.season;
    if (!s.names.length) { document.getElementById("chart-captaincy").innerHTML = ""; return; }
    hbar("chart-captaincy", s.names, s.counts, {
      color: PAL[4], height: tallHeight(s.names.length), unit: "picks",
      xtitle: "Times captained across the league", leftMargin: 120
    });
  }

  /* ---------- consistency (box) -------------------------------- */
  function renderConsistency() {
    var c = C.consistency;
    if (!document.getElementById("chart-consistency")) return;
    if (!c.managers.length || GWS.length < 2) return;
    var traces = c.managers.map(function (name, i) {
      return {
        type: "box", orientation: "h", y: Array(c.scores[i].length).fill(name), x: c.scores[i],
        name: name, marker: { color: ACCENT }, line: { color: ACCENT }, fillcolor: "rgba(57,135,229,0.18)",
        boxpoints: "all", jitter: 0.4, pointpos: 0, hovertemplate: name + ": %{x}<extra></extra>"
      };
    });
    Plotly.newPlot("chart-consistency", traces, layout({
      height: tallHeight(c.managers.length),
      margin: { l: 150, r: 24, t: 8, b: 36 },
      xaxis: { title: "Gameweek score", gridcolor: GRID, linecolor: BORDER, tickfont: { color: MUTED } },
      yaxis: { autorange: "reversed", tickfont: { color: INK, size: 11 }, automargin: true }
    }), CONFIG);
  }

  /* ---------- bench + hits ------------------------------------ */
  function renderBench() {
    hbar("chart-bench", C.bench.labels || C.bench.managers, C.bench.points,
      { raw: C.bench.managers, color: PAL[3], unit: "pts", leftMargin: 200,
        height: tall2(C.bench.managers.length),
        xtitle: "Points left on the bench (season)" });
  }
  function renderHits() {
    if (!document.getElementById("chart-hits")) return;
    var idx = [];
    C.hits.hits.forEach(function (v, i) { if (v > 0) idx.push(i); });
    if (!idx.length) return;
    var lbl = C.hits.labels || C.hits.managers;
    hbar("chart-hits",
      idx.map(function (i) { return lbl[i]; }),
      idx.map(function (i) { return C.hits.hits[i]; }),
      { raw: idx.map(function (i) { return C.hits.managers[i]; }),
        color: PAL[7], unit: "pts", leftMargin: 200, height: tall2(idx.length),
        xtitle: "Points spent on transfer hits (season)",
        fmt: function (v) { return "-" + v; } });
  }

  /* ---------- groups + clubs -------------------------------- */
  function renderGroups() {
    if (C.groups.empty) return;
    var lb = C.groups.leaderboard;
    // colour follows the group, consistent across both charts (stable by name)
    var gcolor = {};
    lb.map(function (r) { return r.group; }).sort().forEach(function (name, i) {
      gcolor[name] = PAL[i % PAL.length];
    });
    hbar("chart-groups",
      lb.map(function (r) { return r.emoji + "  " + r.group + " (" + r.n + ")"; }),
      lb.map(function (r) { return r.avg_points; }),
      { colors: lb.map(function (r) { return gcolor[r.group]; }),
        height: Math.max(240, lb.length * 46 + 90), unit: "pts",
        xtitle: "Avg points per manager", leftMargin: 250 });

    var t = C.groups.trajectory.map(function (g) {
      return {
        type: "scatter", mode: "lines+markers", x: C.groups.gws, y: g.avg_rank,
        name: (g.emoji ? g.emoji + " " : "") + g.group,
        line: { color: gcolor[g.group], width: 2.5, shape: "spline" }, marker: { size: 7 },
        connectgaps: false, hovertemplate: g.group + " — avg rank %{y}<extra></extra>"
      };
    });
    Plotly.newPlot("chart-groups-traj", t, layout({
      height: 340, showlegend: true, legend: { orientation: "h", y: -0.2, font: { color: INK } },
      xaxis: { title: "Gameweek", tickmode: "linear", dtick: 1, gridcolor: GRID, linecolor: BORDER, tickfont: { color: MUTED } },
      yaxis: { title: "Average league rank", autorange: "reversed", gridcolor: GRID, linecolor: BORDER, tickfont: { color: MUTED } }
    }), CONFIG);
  }

  function renderClubs() {
    if (C.clubs.empty) return;
    var lb = C.clubs.leaderboard;
    hbar("chart-clubs", lb.map(function (r) { return r.club + " (" + r.n + ")"; }),
      lb.map(function (r) { return r.avg_points; }),
      { colors: lb.map(function (r) { return r.color; }),
        height: Math.max(300, lb.length * 40 + 90), unit: "pts",
        xtitle: "Avg points per manager", leftMargin: 130 });
  }

  /* ---------- go ------------------------------------------- */
  function run() {
    renderBump(); renderRace(); renderPodium(); renderCaptaincy();
    renderConsistency(); renderBench(); renderHits(); renderGroups(); renderClubs();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
