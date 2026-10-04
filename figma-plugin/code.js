// AI Factory Import: builds an approved AI Factory design in the open Figma file from the `figma.json` the factory exports
// (factory design export <run> --format figma, or Figma in the Design tab's Export). It reads only the file the user picks,
// has no network access and needs no token: any plan that can edit the file can run it (docs/estimates-design.md, "Figma").
//
// What it builds: a page per app with a frame per screen x state x width x mode x language (auto layout where the demo's
// rows and columns allow it), a Components page with a component set per control and block, its variants from the
// Components page's grids, and the tokens as variables with Light and Dark modes. Figma's free plan allows one mode per
// collection, so there the dark values go in a collection of their own.
//
// Plain JavaScript with no build step and no optional chaining, so it runs in Figma's plugin sandbox as it is. The import
// is `importDoc(doc, figma, progress)`, which the factory's tests run against a stand-in for the `figma` object.

var SCHEMA_VERSION = 1;
var GAP = 80, ROW_GAP = 200;
var GENERIC = /^(system-ui|-apple-system|blinkmacsystemfont|sans-serif|serif|monospace|cursive|fantasy|ui-[\w-]+|inherit|emoji|math)$/i;

function rgb(c) { return { r: c[0], g: c[1], b: c[2] }; }
function key(c) { return c.map(function (x) { return Math.round(x * 255); }).join(","); }
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

/** The weight a font style's name stands for (Figma's fonts are named "Semi Bold Italic" and the like). */
function styleWeight(style) {
  var s = style.toLowerCase().replace(/[\s_-]/g, "");
  var w = 400;
  if (/thin|hairline/.test(s)) w = 100;
  else if (/extralight|ultralight/.test(s)) w = 200;
  else if (/semibold|demibold/.test(s)) w = 600;
  else if (/extrabold|ultrabold/.test(s)) w = 800;
  else if (/light/.test(s)) w = 300;
  else if (/medium/.test(s)) w = 500;
  else if (/black|heavy/.test(s)) w = 900;
  else if (/bold/.test(s)) w = 700;
  var n = /(\d{3})/.exec(s);
  if (n) w = Number(n[1]);
  return w;
}

/** Fonts: the first family of each text's CSS stack that Figma has, in the style nearest its weight; Inter when none. */
function makeFonts(available) {
  var families = {};
  available.forEach(function (f) {
    var k = f.fontName.family.toLowerCase();
    (families[k] = families[k] || []).push({ name: f.fontName, weight: styleWeight(f.fontName.style), italic: /italic|oblique/i.test(f.fontName.style) });
  });
  var cache = {}, swapped = {};
  function pick(list, weight, italic) {
    var best = null, score = Infinity;
    list.forEach(function (s) {
      var d = Math.abs(s.weight - weight) + (s.italic === !!italic ? 0 : 1000);
      if (d < score) { score = d; best = s; }
    });
    return best ? best.name : null;
  }
  return {
    resolve: function (font) {
      var id = font.families.join("|") + "|" + font.weight + "|" + (font.italic ? 1 : 0);
      if (cache[id]) return cache[id];
      var name = null, wanted = null;
      for (var i = 0; i < font.families.length && !name; i++) {
        var fam = font.families[i];
        if (GENERIC.test(fam)) continue;
        if (!wanted) wanted = fam;
        var list = families[fam.toLowerCase()] || families[fam.toLowerCase().replace(/\s+var$/, "")];
        if (list) name = pick(list, font.weight, font.italic);
      }
      if (!name) {
        name = pick(families["inter"] || [], font.weight, font.italic) || { family: "Inter", style: "Regular" };
        if (wanted) swapped[wanted] = name.family;
      }
      cache[id] = name;
      return name;
    },
    swapped: swapped,
  };
}

/** A linear gradient's transform in Figma's unit square, from a CSS angle (0 is to the top, 90 to the right). */
function gradientTransform(angle) {
  var r = (angle - 90) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return [[c, s, 0.5 - 0.5 * c - 0.5 * s], [-s, c, 0.5 + 0.5 * s - 0.5 * c]];
}

/** The tokens as variables: one collection with Light and Dark modes, or, where the plan allows one mode, one per mode. */
function makeVariables(api, doc, notes) {
  var out = { byMode: {}, collections: {}, modeIds: {}, count: 0, split: false };
  if (!doc.tokens || !api.variables) return out;
  var modes = doc.tokens.modes;
  var title = doc.product + " tokens (" + doc.line + " v" + doc.version + ")";
  var main = api.variables.createVariableCollection(title);
  main.renameMode(main.modes[0].modeId, cap(modes[0]));
  out.collections[modes[0]] = main;
  out.modeIds[modes[0]] = main.modes[0].modeId;
  for (var i = 1; i < modes.length; i++) {
    try {
      out.modeIds[modes[i]] = main.addMode(cap(modes[i]));
      out.collections[modes[i]] = main;
    } catch (e) {
      // the free plan's limit: the other mode's values in their own collection
      var own = api.variables.createVariableCollection(title + " - " + cap(modes[i]));
      own.renameMode(own.modes[0].modeId, cap(modes[i]));
      out.collections[modes[i]] = own;
      out.modeIds[modes[i]] = own.modes[0].modeId;
      out.split = true;
      notes.push("This plan allows one mode per variable collection, so the " + modes[i] + " values are in their own collection.");
    }
  }
  modes.forEach(function (m) { out.byMode[m] = {}; });
  doc.tokens.variables.forEach(function (v) {
    var made = {};
    modes.forEach(function (m) {
      if (v.values[m] === undefined) return;
      var col = out.collections[m];
      var variable = made[col.id];
      if (!variable) { variable = api.variables.createVariable(v.name, col, v.type); made[col.id] = variable; out.count++; }
      var val = v.values[m];
      variable.setValueForMode(out.modeIds[m], v.type === "COLOR" ? { r: val[0], g: val[1], b: val[2], a: val[3] } : val);
      if (v.type === "COLOR") { var k = key(val); if (!out.byMode[m][k]) out.byMode[m][k] = variable; }
    });
  });
  return out;
}

/** Builds one frame of the design; nodes that carry a component are handed to `onComponent`. */
function makeBuilder(api, fonts, vars, stats) {
  function paint(c, mode) {
    var p = { type: "SOLID", color: rgb(c), opacity: c[3] };
    var v = vars.byMode[mode] && vars.byMode[mode][key(c)];
    if (v && api.variables && api.variables.setBoundVariableForPaint) {
      try { p = api.variables.setBoundVariableForPaint(p, "color", v); p.opacity = c[3]; stats.bound++; } catch (e) { /* the colour stays as it is */ }
    }
    return p;
  }
  function frame(n, mode, onComponent) {
    var f = api.createFrame();
    f.name = n.name;
    f.resize(Math.max(0.01, n.w), Math.max(0.01, n.h));
    f.x = n.x; f.y = n.y;
    var fills = [];
    if (n.fill) fills.push(paint(n.fill, mode));
    if (n.gradient) fills.push({ type: "GRADIENT_LINEAR", gradientTransform: gradientTransform(n.gradient.angle), gradientStops: n.gradient.stops.map(function (s) { return { color: { r: s.color[0], g: s.color[1], b: s.color[2], a: s.color[3] }, position: s.at }; }) });
    f.fills = fills;
    f.clipsContent = !!n.clip;
    if (n.opacity !== undefined) f.opacity = n.opacity;
    if (n.stroke) {
      f.strokes = [paint(n.stroke.color, mode)];
      f.strokeAlign = "INSIDE";
      var w = n.stroke.w;
      if (w[0] === w[1] && w[1] === w[2] && w[2] === w[3]) f.strokeWeight = w[0];
      else { f.strokeTopWeight = w[0]; f.strokeRightWeight = w[1]; f.strokeBottomWeight = w[2]; f.strokeLeftWeight = w[3]; }
    }
    if (n.radius) {
      var r = n.radius;
      if (r[0] === r[1] && r[1] === r[2] && r[2] === r[3]) f.cornerRadius = r[0];
      else { f.topLeftRadius = r[0]; f.topRightRadius = r[1]; f.bottomRightRadius = r[2]; f.bottomLeftRadius = r[3]; }
    }
    if (n.shadows) {
      f.effects = n.shadows.map(function (s) {
        return { type: s.inset ? "INNER_SHADOW" : "DROP_SHADOW", color: { r: s.color[0], g: s.color[1], b: s.color[2], a: s.color[3] }, offset: { x: s.x, y: s.y }, radius: s.blur, spread: s.spread, visible: true, blendMode: "NORMAL" };
      });
    }
    if (n.auto) {
      f.layoutMode = n.auto.dir === "H" ? "HORIZONTAL" : "VERTICAL";
      f.primaryAxisSizingMode = "FIXED";
      f.counterAxisSizingMode = "FIXED";
      f.itemSpacing = n.auto.gap;
      f.paddingTop = n.auto.pad[0]; f.paddingRight = n.auto.pad[1]; f.paddingBottom = n.auto.pad[2]; f.paddingLeft = n.auto.pad[3];
      f.primaryAxisAlignItems = "MIN";
      f.counterAxisAlignItems = n.auto.align;
      f.resize(Math.max(0.01, n.w), Math.max(0.01, n.h));
      stats.auto++;
    }
    stats.frames++;
    n.children.forEach(function (k) { var c = node(k, mode, onComponent); if (c) f.appendChild(c); });
    if (n.component && onComponent) onComponent(n.component, f);
    return f;
  }
  function text(n, mode) {
    var t = api.createText();
    t.fontName = fonts.resolve(n.font);
    t.characters = n.chars;
    t.name = n.name;
    t.fontSize = Math.max(1, n.font.size);
    if (n.font.lineHeight) t.lineHeight = { unit: "PIXELS", value: n.font.lineHeight };
    if (n.font.letterSpacing) t.letterSpacing = { unit: "PIXELS", value: n.font.letterSpacing };
    if (n.font.case) t.textCase = n.font.case;
    if (n.font.underline) t.textDecoration = "UNDERLINE";
    else if (n.font.strike) t.textDecoration = "STRIKETHROUGH";
    t.fills = [paint(n.color, mode)];
    t.textAlignHorizontal = n.align;
    if (n.opacity !== undefined) t.opacity = n.opacity;
    if (n.lines > 1 || n.align !== "LEFT") {
      // a fixed width (a little slack for a font that runs wider), so wrapped and aligned text keeps its box
      var slack = n.lines > 1 ? 0 : 4;
      t.resize(Math.max(1, n.w + slack), Math.max(1, n.h));
      t.textAutoResize = "HEIGHT";
      t.x = n.x - (n.align === "RIGHT" ? slack : n.align === "CENTER" ? slack / 2 : 0);
    } else {
      t.textAutoResize = "WIDTH_AND_HEIGHT";
      t.x = n.x;
    }
    t.y = n.y;
    stats.texts++;
    return t;
  }
  function svg(n) {
    try {
      var s = api.createNodeFromSvg(n.svg);
      s.name = n.name;
      s.x = n.x; s.y = n.y;
      if (Math.abs(s.width - n.w) > 0.5 || Math.abs(s.height - n.h) > 0.5) s.resize(Math.max(0.01, n.w), Math.max(0.01, n.h));
      if (n.opacity !== undefined) s.opacity = n.opacity;
      stats.svgs++;
      return s;
    } catch (e) {
      stats.skipped++;
      return null;
    }
  }
  function image(n) {
    if (!n.png) { stats.skipped++; return null; }
    var r = api.createRectangle();
    r.name = n.name;
    r.resize(Math.max(0.01, n.w), Math.max(0.01, n.h));
    r.x = n.x; r.y = n.y;
    r.fills = [{ type: "IMAGE", imageHash: api.createImage(api.base64Decode(n.png)).hash, scaleMode: "FILL" }];
    stats.images++;
    return r;
  }
  function node(n, mode, onComponent) {
    if (n.t === "frame") return frame(n, mode, onComponent);
    if (n.t === "text") return text(n, mode);
    if (n.t === "svg") return svg(n);
    return image(n);
  }
  return { frame: frame };
}

/** Variant names in a set must differ: a repeated one gets a number on its last property. */
function variantName(props, taken) {
  var keys = Object.keys(props);
  var base = keys.map(function (k) { return k + "=" + String(props[k]).replace(/[=,]/g, " "); }).join(", ");
  var name = base, i = 2;
  while (taken[name]) { name = base + " " + i; i++; }
  taken[name] = true;
  return name;
}

/**
 * Builds `doc` in the open file: the variables, a page per app with its frames, and the Components page with its sets.
 * Returns what it made, for the plugin's window.
 */
async function importDoc(doc, api, progress) {
  if (!doc || doc.kind !== "ai-factory/figma") throw new Error("This is not an AI Factory figma.json. Export it with: factory design export <run> --format figma");
  if (doc.schemaVersion > SCHEMA_VERSION) throw new Error("This figma.json is newer than the plugin (schema " + doc.schemaVersion + "). Update the AI Factory Import plugin.");
  var say = progress || function () {};
  var notes = [];
  var stats = { frames: 0, texts: 0, svgs: 0, images: 0, auto: 0, bound: 0, skipped: 0 };
  say("Adding the tokens as variables");
  var vars = makeVariables(api, doc, notes);
  say("Loading fonts");
  var fonts = makeFonts(await api.listAvailableFontsAsync());
  var needed = {};
  var walk = function (n) { if (n.t === "text") { var f = fonts.resolve(n.font); needed[f.family + "|" + f.style] = f; } if (n.t === "frame") n.children.forEach(walk); };
  doc.frames.forEach(function (f) { walk(f.root); });
  var list = Object.keys(needed).map(function (k) { return needed[k]; });
  for (var i = 0; i < list.length; i++) await api.loadFontAsync(list[i]);
  var build = makeBuilder(api, fonts, vars, stats);
  var suffix = " - " + doc.line + " v" + doc.version;
  var pages = [], madeFrames = [];
  var componentItems = [], componentSource = null;
  // the frame the component sets are made from: light, the first language, the widest
  var sources = doc.frames.filter(function (f) { return f.app === "components" && f.mode === "light"; });
  sources.sort(function (a, b) { return b.w - a.w; });
  if (sources.length) componentSource = sources.filter(function (f) { return f.dir === "ltr"; })[0] || sources[0];
  var apps = doc.apps.length ? doc.apps : [{ id: "", name: doc.product }];
  for (var a = 0; a < apps.length; a++) {
    var app = apps[a];
    var frames = doc.frames.filter(function (f) { return f.app === app.id; });
    if (!frames.length) continue;
    var page = api.createPage();
    page.name = app.name + suffix;
    pages.push(page);
    var rows = [], byScreen = {};
    frames.forEach(function (f) { if (!byScreen[f.screen]) { byScreen[f.screen] = []; rows.push(byScreen[f.screen]); } byScreen[f.screen].push(f); });
    var y = 0;
    for (var r = 0; r < rows.length; r++) {
      var x = 0, tallest = 0;
      for (var k = 0; k < rows[r].length; k++) {
        var spec = rows[r][k];
        say("Building " + spec.name);
        var mode = spec.mode;
        var mine = spec === componentSource ? function (c, node) { componentItems.push({ set: c.set, props: c.props, node: node }); } : null;
        var top = build.frame(spec.root, mode, mine);
        top.name = spec.name;
        top.x = x; top.y = y;
        top.clipsContent = true;
        page.appendChild(top);
        var col = vars.collections[mode];
        if (col && !vars.split && vars.modeIds[mode] && top.setExplicitVariableModeForCollection) {
          try { top.setExplicitVariableModeForCollection(col, vars.modeIds[mode]); } catch (e) { /* the frame shows the default mode */ }
        }
        if (spec.picture) {
          // the approved picture under the layers, hidden and locked, to compare with
          var ref = api.createRectangle();
          ref.name = "Approved picture (reference)";
          ref.resize(Math.max(0.01, spec.w), Math.max(0.01, spec.h));
          ref.fills = [{ type: "IMAGE", imageHash: api.createImage(api.base64Decode(spec.picture)).hash, scaleMode: "FILL" }];
          top.insertChild(0, ref);
          if (top.layoutMode && top.layoutMode !== "NONE") ref.layoutPositioning = "ABSOLUTE";
          ref.x = 0; ref.y = 0;
          ref.visible = false;
          ref.locked = true;
        }
        if (top.setPluginData) top.setPluginData("ai-factory", JSON.stringify({ screen: spec.screen, state: spec.state, viewport: spec.viewport, mode: spec.mode, lang: spec.lang, line: doc.line, version: doc.version, designSha: doc.designSha }));
        madeFrames.push(top);
        x += spec.w + GAP;
        tallest = Math.max(tallest, spec.h);
      }
      y += tallest + ROW_GAP;
    }
  }
  // the component sets, from copies of the Components page's cells, on a page of their own
  var sets = 0, components = 0;
  if (componentItems.length) {
    say("Making the components");
    var cpage = api.createPage();
    cpage.name = "Component sets" + suffix;
    pages.push(cpage);
    var groups = {}, order = [];
    componentItems.forEach(function (it) { if (!groups[it.set]) { groups[it.set] = []; order.push(it.set); } groups[it.set].push(it); });
    var cy = 0;
    for (var g = 0; g < order.length; g++) {
      var taken = {}, made = [];
      groups[order[g]].forEach(function (it) {
        var copy = it.node.clone();
        cpage.appendChild(copy);
        var comp = api.createComponentFromNode(copy);
        comp.name = variantName(it.props, taken);
        made.push(comp);
      });
      var set = api.combineAsVariants(made, cpage);
      set.name = order[g];
      set.layoutMode = "HORIZONTAL";
      set.layoutWrap = "WRAP";
      set.itemSpacing = 24;
      set.counterAxisSpacing = 24;
      set.paddingTop = set.paddingRight = set.paddingBottom = set.paddingLeft = 24;
      set.primaryAxisSizingMode = "FIXED";
      set.counterAxisSizingMode = "AUTO";
      set.resize(1200, Math.max(1, set.height));
      set.x = 0; set.y = cy;
      cy += set.height + 120;
      sets++;
      components += made.length;
    }
  }
  var swapped = Object.keys(fonts.swapped);
  if (swapped.length) notes.push("Not in this Figma, so shown in " + fonts.swapped[swapped[0]] + ": " + swapped.join(", ") + ". Install them (or add them to the team) and change the text styles to match the design.");
  if (stats.skipped) notes.push(stats.skipped + " layer(s) could not be made (an icon Figma could not read, or a picture that was not exported).");
  (doc.notes || []).forEach(function (n) { notes.push(n); });
  if (pages.length && api.setCurrentPageAsync) { try { await api.setCurrentPageAsync(pages[0]); } catch (e) { /* stays on the current page */ } }
  if (madeFrames.length && api.viewport) { try { api.viewport.scrollAndZoomIntoView(madeFrames.filter(function (f) { return f.parent === pages[0]; }).slice(0, 4)); } catch (e) { /* the view stays */ } }
  return {
    tag: doc.tag, pages: pages.map(function (p) { return p.name; }), frames: madeFrames.length, layers: stats.frames + stats.texts + stats.svgs + stats.images,
    autoLayout: stats.auto, componentSets: sets, components: components, variables: vars.count, boundColours: stats.bound,
    darkCollection: vars.split, notes: notes,
  };
}

if (typeof module !== "undefined") module.exports = { importDoc: importDoc, styleWeight: styleWeight, makeFonts: makeFonts, variantName: variantName, gradientTransform: gradientTransform };

if (typeof figma !== "undefined" && typeof __html__ !== "undefined") {
  figma.showUI(__html__, { width: 380, height: 360, title: "AI Factory Import" });
  figma.ui.onmessage = async function (msg) {
    if (msg.type === "close") { figma.closePlugin(); return; }
    if (msg.type !== "import") return;
    try {
      var summary = await importDoc(msg.doc, figma, function (text) { figma.ui.postMessage({ type: "progress", text: text }); });
      figma.ui.postMessage({ type: "done", summary: summary });
      figma.notify("AI Factory: " + summary.frames + " frame(s) and " + summary.components + " component(s) imported");
    } catch (e) {
      figma.ui.postMessage({ type: "error", text: e && e.message ? e.message : String(e) });
    }
  };
}
