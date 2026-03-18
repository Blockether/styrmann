(ns com.blockether.styrmann.presentation.component.layout
  "Shared SSR layout — warm editorial design inspired by Claura."
  (:require
   [hiccup2.core :as h]
   [starfederation.datastar.clojure.api :as d*]))

(def ^:private base-styles
  "@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Inter:wght@400;500;600;700&display=swap');
:root {
  --cream: #faf9f6;
  --cream-light: #fffdf9;
  --cream-dark: #f0ebe4;
  --surface: #ffffff;
  --charcoal: #1a1a1f;
  --charcoal-light: #2d2d35;
  --ink: #1a1a1f;
  --ink-secondary: #4a4a55;
  --muted: #8b8b95;
  --line: rgba(0,0,0,0.08);
  --line-strong: rgba(0,0,0,0.14);
  --accent: #ff6b35;
  --accent-hover: #e85a28;
  --accent-soft: rgba(255,107,53,0.1);
  --good: #1a7f5a;
  --good-soft: rgba(26,127,90,0.1);
  --warn: #c47a20;
  --warn-soft: rgba(196,122,32,0.1);
  --danger: #c43c2c;
  --danger-soft: rgba(196,60,44,0.1);
  --purple: #6b4fc0;
  --purple-soft: rgba(107,79,192,0.1);
  --teal: #2a8f8f;
  --teal-soft: rgba(42,143,143,0.1);
  --brown: #5c4332;
  --brown-soft: rgba(92,67,50,0.1);
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
 body { background: var(--cream); color: var(--ink); margin: 0; -webkit-font-smoothing: antialiased; touch-action: manipulation; }
 * { box-sizing: border-box; }
 a, button, summary, input, select, textarea { touch-action: manipulation; }
 button, a { -webkit-tap-highlight-color: transparent; }
 h1, h2, h3 { font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; letter-spacing: -0.02em; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-xl); }
.card-sm { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-lg); }
.btn-primary { display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: var(--charcoal); color: #fff; border: none; border-radius: var(--radius-sm); padding: 10px 20px; font-size: 14px; font-weight: 500; cursor: pointer; transition: background .2s, transform .15s; }
.btn-primary:hover { background: var(--charcoal-light); transform: translateY(-1px); }
.btn-secondary { display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: transparent; color: var(--ink-secondary); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); padding: 8px 16px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all .2s; }
.btn-secondary:hover { background: var(--cream-dark); border-color: var(--charcoal); color: var(--ink); }
.input { border: 1.5px solid var(--line-strong); background: var(--surface); color: var(--ink); border-radius: var(--radius-sm); padding: 10px 14px; font-size: 14px; transition: border-color .2s, box-shadow .2s; width: 100%; font-family: inherit; }
.input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
textarea.input { min-height: 100px; resize: vertical; }
a { color: var(--accent); text-decoration: none; transition: color .15s; }
a:hover { color: var(--accent-hover); }
.badge { display: inline-flex; align-items: center; border-radius: 6px; padding: 3px 10px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
.badge-feature { background: var(--good-soft); color: var(--good); }
.badge-bug { background: var(--danger-soft); color: var(--danger); }
.badge-chore { background: var(--purple-soft); color: var(--purple); }
.badge-docs { background: var(--teal-soft); color: var(--teal); }
.badge-spike { background: var(--warn-soft); color: var(--warn); }
.badge-inbox { background: var(--cream-dark); color: var(--muted); }
.badge-implementing { background: var(--accent-soft); color: var(--accent); }
.badge-testing { background: var(--warn-soft); color: var(--warn); }
.badge-reviewing { background: var(--purple-soft); color: var(--purple); }
.badge-done { background: var(--good-soft); color: var(--good); }
.avatar { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; background: var(--charcoal); color: #fff; font-size: 12px; font-weight: 600; flex-shrink: 0; }
.field-label { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; }
 .board-card { background: var(--surface); border-radius: var(--radius-md); border: 1px solid var(--line); padding: 12px; transition: box-shadow .2s, transform .15s; }
 .board-card:hover { box-shadow: 0 4px 20px rgba(0,0,0,0.08); transform: translateY(-1px); }
 .toolbar-tab { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border-radius: 999px; padding: 10px 16px; font-size: 13px; font-weight: 600; color: var(--ink-secondary); background: var(--cream-dark); border: 1px solid transparent; transition: all .2s; cursor: pointer; }
 .toolbar-tab:hover { color: var(--ink); border-color: var(--line-strong); }
 .toolbar-tab.is-active { background: var(--charcoal); color: #fff; }
 .toolbar-action { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border-radius: 999px; padding: 10px 14px; font-size: 13px; font-weight: 600; background: var(--surface); color: var(--ink); border: 1px solid var(--line); cursor: pointer; transition: all .2s; }
 .toolbar-action:hover { border-color: var(--line-strong); box-shadow: 0 4px 20px rgba(0,0,0,0.06); }
 .topbar-menu { position: relative; }
 .topbar-menu-panel { position: absolute; right: 0; top: calc(100% + 10px); min-width: 240px; display: none; background: var(--surface); border: 1px solid var(--line); border-radius: 20px; box-shadow: 0 18px 48px rgba(26,26,31,0.14); padding: 10px; z-index: 90; }
 .topbar-menu.is-open .topbar-menu-panel { display: block; }
 .topbar-menu-link { display: flex; align-items: center; gap: 10px; border-radius: 14px; padding: 10px 12px; color: var(--ink); text-decoration: none; font-size: 13px; font-weight: 500; }
 .topbar-menu-link:hover { background: var(--cream-dark); }
 .modal-backdrop { position: fixed; inset: 0; background: rgba(26,26,31,0.48); display: none; align-items: flex-end; justify-content: center; padding: 16px; z-index: 80; }
 .modal-backdrop.is-open { display: flex; }
 .modal-shell { width: 100%; max-width: 680px; max-height: 88vh; overflow: auto; background: var(--surface); border-radius: 28px; border: 1px solid var(--line); box-shadow: 0 24px 80px rgba(26,26,31,0.18); }
 .view-panel[hidden] { display: none !important; }
 [data-closed] { display: none; }
 [data-done] { display: none; }
 .show-closed [data-closed] { display: block; opacity: 0.5; }
 .show-done [data-done] { display: block; opacity: 0.5; }
 .show-closed [data-closed] .ticket-title, .show-done [data-done] .task-title { text-decoration: line-through; }
 .show-closed .board-card[data-closed] { display: block; opacity: 0.45; }
 .show-done .board-card[data-done] { display: block; opacity: 0.45; }
 .show-closed .board-card[data-closed] .ticket-title, .show-done .board-card[data-done] .task-title { text-decoration: line-through; }
 .done-toggle { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12px; font-weight: 500; color: var(--muted); user-select: none; }
 .done-toggle input { accent-color: var(--accent); }
 .org-chip { display: inline-flex; align-items: center; gap: 10px; border-radius: 999px; background: var(--cream-dark); padding: 6px 12px 6px 8px; color: var(--ink); }
 .org-chip-mark { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 999px; background: var(--accent); color: white; font-family: 'DM Serif Display', Georgia, serif; font-size: 16px; }
 @media (max-width: 768px) {
   .board-scroll { flex-direction: column !important; }
   .board-scroll > * { min-width: 100% !important; max-width: 100% !important; }
   .modal-backdrop { align-items: flex-end; padding: 0; }
   .modal-shell { max-width: 100%; max-height: 92vh; border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
 }")

(defn raw-html
  "Wrap raw HTML for Hiccup rendering.

   Params:
   `content` - String or Hiccup content.

   Returns:
   Hiccup-compatible content with strings left unescaped."
  [content]
  (if (string? content) (h/raw content) content))

(defn render-fragment
  "Render a Hiccup fragment or raw HTML string.

   Params:
   `content` - Hiccup node or HTML string.

   Returns:
   HTML string."
  [content]
  (str (h/html (raw-html content))))

(defn panel-node
  "Wrap inner content in a styled card panel.

   Params:
   `content` - Hiccup node or HTML string.

   Returns:
   Hiccup node."
  [content]
  [:div {:class "card p-6"} (raw-html content)])

(defn- page-node
  ([title body] (page-node title body {}))
  ([title body {:keys [breadcrumbs topbar-context]}]
   [:html {:lang "en"}
    [:head
     [:meta {:charset "UTF-8"}]
     [:meta {:name "viewport" :content "width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"}]
     [:meta {:name "apple-mobile-web-app-capable" :content "yes"}]
     [:meta {:name "apple-mobile-web-app-status-bar-style" :content "black-translucent"}]
     [:meta {:name "apple-mobile-web-app-title" :content "Styrmann"}]
     [:meta {:name "theme-color" :content "#1a1a1f"}]
     [:link {:rel "manifest" :href "/site.webmanifest"}]
     [:link {:rel "apple-touch-icon" :href "/apple-touch-icon.svg"}]
     [:link {:rel "icon" :type "image/svg+xml" :href "/icon-192.svg"}]
     [:title (str title " — Styrmann")]
     [:script {:src "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"}]
     [:script {:src "https://unpkg.com/lucide@latest"}]
     [:script {:type "module" :src d*/CDN-url}]
     [:style (raw-html base-styles)]]
    [:body {:class "min-h-screen bg-[var(--cream)]"}
     [:div {:id "global-create-organization" :class "modal-backdrop" :role "dialog" :aria-modal "true"}
      [:div {:class "modal-shell"}
       [:div {:class "flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4"}
        [:div
         [:div {:class "field-label mb-1"} "Organization"]
         [:h2 {:class "text-[24px] leading-none"} "Create organization"]]
        [:button {:type "button" :class "toolbar-action !px-3 !py-2" :data-modal-close true}
         [:i {:data-lucide "x" :class "size-4"}]]]
       [:div {:class "px-5 py-5"}
        [:form {:class "space-y-4" :method "post" :action "/organizations"}
         [:label {:class "block"}
          [:span {:class "field-label"} "Organization name"]
          [:input {:class "input" :type "text" :name "name" :placeholder "Blockether" :required true}]]
         [:div {:class "flex justify-end"}
          [:button {:class "btn-primary" :type "submit"} "Create organization"]]]]]]
      ;; Top nav
     [:nav {:class "sticky top-0 z-50 bg-[var(--surface)] border-b border-[var(--line)] backdrop-blur-sm"}
      [:div {:class "mx-auto max-w-6xl flex items-center justify-between px-5 h-14 gap-3"}
       [:a {:href "/"
            :data-on-click (str "$evt.preventDefault();" (d*/sse-get "/fragments/home"))
            :class "flex items-center gap-2.5 no-underline cursor-pointer"}
        [:div {:class "flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--charcoal)]"}
         [:i {:data-lucide "anchor" :class "size-4 text-white"}]]
        [:span {:class "text-[17px] font-semibold tracking-tight text-[var(--ink)]"
                :style "font-family: 'DM Serif Display', Georgia, serif"}
         "Styrmann"]]
       [:div {:class "flex items-center gap-2 sm:gap-3"}
        [:button {:type "button" :class "toolbar-action whitespace-nowrap" :data-modal-open "global-create-organization"}
         [:i {:data-lucide "plus" :class "size-4 text-[var(--accent)]"}]
         [:span {:class "hidden sm:inline"} "Create organization"]]
        [:div {:id "topbar-context"}
         (raw-html topbar-context)]]]]
      ;; Breadcrumbs
     [:div {:id "breadcrumbs" :class "mx-auto max-w-6xl px-5 pt-4 pb-1"}
      (when (seq breadcrumbs)
        (into [:div {:class "flex items-center gap-1.5 text-[12px] text-[var(--muted)]"}]
              (interpose
               [:span "/"]
               (for [{:keys [href label]} breadcrumbs]
                 (if href
                   [:a {:href href :class "text-[var(--muted)] hover:text-[var(--accent)] no-underline"} label]
                   [:span {:class "font-medium text-[var(--ink-secondary)]"} label])))))]
     ;; Main
     [:main {:id "main-content" :class "mx-auto max-w-6xl px-5 py-6"}
      (raw-html body)]
     [:script (raw-html "
window.styrmannInitInteractive = function(root = document) {
  root.querySelectorAll('[data-view-root]').forEach(function(viewRoot) {
    if (viewRoot.dataset.bound === 'true') return;
    viewRoot.dataset.bound = 'true';
    var tabs = viewRoot.querySelectorAll('[data-view-tab]');
    var panels = viewRoot.querySelectorAll('[data-view-panel]');
    function activate(target) {
      tabs.forEach(function(tab) {
        tab.classList.toggle('is-active', tab.getAttribute('data-view-tab') === target);
      });
      panels.forEach(function(panel) {
        panel.hidden = panel.getAttribute('data-view-panel') !== target;
      });
    }
    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        activate(tab.getAttribute('data-view-tab'));
      });
    });
    var initial = viewRoot.getAttribute('data-view-default') || (tabs[0] && tabs[0].getAttribute('data-view-tab'));
    if (initial) activate(initial);
  });
  root.querySelectorAll('[data-modal-open]').forEach(function(button) {
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', function() {
      var target = document.getElementById(button.getAttribute('data-modal-open'));
      if (target) target.classList.add('is-open');
    });
  });
  root.querySelectorAll('[data-modal-close]').forEach(function(button) {
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', function() {
      var target = button.closest('.modal-backdrop');
      if (target) target.classList.remove('is-open');
    });
  });
  root.querySelectorAll('.modal-backdrop').forEach(function(backdrop) {
    if (backdrop.dataset.bound === 'true') return;
    backdrop.dataset.bound = 'true';
    backdrop.addEventListener('click', function(evt) {
      if (evt.target === backdrop) backdrop.classList.remove('is-open');
    });
  });
  root.querySelectorAll('[data-done-toggle]').forEach(function(label) {
    if (label.dataset.bound === 'true') return;
    label.dataset.bound = 'true';
    var checkbox = label.querySelector('input[type=checkbox]');
    var toggleClass = label.getAttribute('data-done-toggle');
    if (!checkbox || !toggleClass) return;
    checkbox.addEventListener('change', function() {
      var section = label.closest('section, .card');
      if (section) {
        if (checkbox.checked) {
          section.classList.add(toggleClass);
        } else {
          section.classList.remove(toggleClass);
        }
      }
    });
  });
  root.querySelectorAll('[data-topbar-toggle]').forEach(function(button) {
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', function(evt) {
      evt.stopPropagation();
      var menu = button.closest('.topbar-menu');
      if (menu) menu.classList.toggle('is-open');
    });
  });
};
document.addEventListener('click', function() {
  document.querySelectorAll('.topbar-menu.is-open').forEach(function(node) {
    node.classList.remove('is-open');
  });
});
document.addEventListener('keydown', function(evt) {
  if (evt.key === 'Escape') {
    document.querySelectorAll('.modal-backdrop.is-open').forEach(function(node) {
      node.classList.remove('is-open');
    });
  }
});
document.addEventListener('gesturestart', function(evt) {
  evt.preventDefault();
});
let __styrmannLastTouchEnd = 0;
document.addEventListener('touchend', function(evt) {
  var now = Date.now();
  if (now - __styrmannLastTouchEnd <= 300) {
    evt.preventDefault();
  }
  __styrmannLastTouchEnd = now;
}, {passive: false});
window.styrmannInitInteractive();
lucide.createIcons();

/* Acceptance Criteria Builder */
(function(){
  var MAX_DEPTH = 3;
  function initACBuilder() {
    var builder = document.getElementById('ac-builder');
    var input = document.getElementById('ac-new-input');
    var addBtn = document.getElementById('ac-add-btn');
    var hiddenField = document.getElementById('ac-hidden-field');
    var form = document.getElementById('ticket-form');
    if (!builder || !input || !addBtn) return;
    if (builder.dataset.acBound === 'true') return;
    builder.dataset.acBound = 'true';

    function createItem(text, depth) {
      var item = document.createElement('div');
      item.className = 'ac-item';
      item.dataset.depth = depth;
      var ml = depth * 24;
      item.innerHTML =
        '<div class=\"flex items-center gap-2\" style=\"margin-left:' + ml + 'px\">' +
          '<span class=\"w-1.5 h-1.5 rounded-full bg-[var(--accent)] flex-shrink-0\"></span>' +
          '<span class=\"ac-text flex-1 text-[13px] text-[var(--ink)]\">' + escapeHtml(text) + '</span>' +
          (depth < MAX_DEPTH - 1
            ? '<button type=\"button\" class=\"ac-sub-btn btn-secondary !px-2 !py-1 !text-[11px] !rounded-md\" title=\"Add sub-criterion\">+ sub</button>'
            : '') +
          '<button type=\"button\" class=\"ac-rm-btn btn-secondary !px-2 !py-1 !text-[11px] !rounded-md text-[var(--danger)]\" title=\"Remove\">&times;</button>' +
        '</div>';
      item.querySelector('.ac-rm-btn').addEventListener('click', function() {
        removeWithChildren(item);
      });
      var subBtn = item.querySelector('.ac-sub-btn');
      if (subBtn) {
        subBtn.addEventListener('click', function() {
          showSubInput(item, depth + 1);
        });
      }
      return item;
    }

    function removeWithChildren(item) {
      var depth = parseInt(item.dataset.depth);
      var toRemove = [item];
      var sibling = item.nextElementSibling;
      while (sibling && parseInt(sibling.dataset.depth) > depth) {
        toRemove.push(sibling);
        sibling = sibling.nextElementSibling;
      }
      toRemove.forEach(function(el) { el.remove(); });
    }

    function showSubInput(afterItem, depth) {
      var existing = afterItem.querySelector('.ac-sub-input-row');
      if (existing) { existing.querySelector('input').focus(); return; }
      var row = document.createElement('div');
      row.className = 'ac-sub-input-row flex items-center gap-2 mt-1 mb-1';
      row.style.marginLeft = (depth * 24) + 'px';
      row.innerHTML =
        '<input class=\"input flex-1 !py-1.5 !text-[13px]\" type=\"text\" placeholder=\"Sub-criterion...\" autocomplete=\"off\">' +
        '<button type=\"button\" class=\"btn-primary !px-2.5 !py-1.5 !text-[12px]\">Add</button>' +
        '<button type=\"button\" class=\"btn-secondary !px-2 !py-1.5 !text-[12px]\">&times;</button>';
      var subInput = row.querySelector('input');
      var subAdd = row.querySelectorAll('button')[0];
      var subCancel = row.querySelectorAll('button')[1];
      function addSub() {
        var val = subInput.value.trim();
        if (!val) return;
        var newItem = createItem(val, depth);
        var insertBefore = findInsertPoint(afterItem, depth);
        builder.insertBefore(newItem, insertBefore);
        subInput.value = '';
        subInput.focus();
      }
      subAdd.addEventListener('click', addSub);
      subInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); addSub(); } });
      subCancel.addEventListener('click', function() { row.remove(); });
      afterItem.after(row);
      subInput.focus();
    }

    function findInsertPoint(afterItem, parentDepth) {
      var sibling = afterItem.nextElementSibling;
      while (sibling && (sibling.classList.contains('ac-sub-input-row') || (sibling.classList.contains('ac-item') && parseInt(sibling.dataset.depth) > parentDepth - 1))) {
        sibling = sibling.nextElementSibling;
      }
      return sibling;
    }

    function addTopLevel() {
      var val = input.value.trim();
      if (!val) return;
      var item = createItem(val, 0);
      builder.appendChild(item);
      input.value = '';
      input.focus();
    }

    addBtn.addEventListener('click', addTopLevel);
    input.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); addTopLevel(); } });

    function serializeToText() {
      var lines = [];
      builder.querySelectorAll('.ac-item').forEach(function(item) {
        var depth = parseInt(item.dataset.depth);
        var text = item.querySelector('.ac-text').textContent;
        var indent = '';
        for (var i = 0; i < depth; i++) indent += '  ';
        lines.push(indent + '- ' + text);
      });
      return lines.join('\\n');
    }

    if (form) {
      form.addEventListener('submit', function() {
        if (hiddenField) hiddenField.value = serializeToText();
      });
    }
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  var origInit = window.styrmannInitInteractive;
  window.styrmannInitInteractive = function(root) {
    origInit(root);
    initACBuilder();
  };
  initACBuilder();
})();
(function(){
  var cv=null;
  function ck(){fetch('/api/version',{cache:'no-store'}).then(function(r){return r.ok?r.text():null}).then(function(v){if(!v)return;v=v.trim();if(cv===null){cv=v}else if(v!==cv){window.location.reload()}}).catch(function(){});}
  ck();setInterval(ck,30000);
})();
")]]]))

(defn page
  "Render a full HTML page.

   Params:
   `title` - String. Page title.
   `body` - String or Hiccup. HTML body contents.

   Returns:
   HTML document string."
  ([title body] (page title body {}))
  ([title body opts]
   (str "<!doctype html>" (render-fragment (page-node title body opts)))))

(defn panel
  "Wrap inner HTML in a styled panel.

   Params:
   `content` - String or Hiccup. Inner HTML.

   Returns:
   HTML string."
  [content]
  (render-fragment (panel-node content)))

(defn nav-attrs
  "Generate href + data-on-click attrs for Datastar-enhanced navigation.

   Params:
   `href` - String. The full page URL (fallback).
   `fragment-path` - String. The SSE fragment URL.

   Returns:
   Map of HTML attributes."
  [href fragment-path]
  {:href href
   :data-on-click (str "$evt.preventDefault();" (d*/sse-get fragment-path))})

(defn stack
  "Join HTML fragments without separators.

   Params:
   `parts` - Seq of HTML strings.

   Returns:
   Combined HTML string."
  [parts]
  (apply str parts))

(defn render-body-fragment
  "Render the main content as an HTML fragment for SSE patching.

   Params:
   `body` - Hiccup node or HTML string. The main content.

   Returns:
   HTML string wrapped in a div with id=main-content."
  [body]
  (render-fragment
   [:main {:id "main-content" :class "mx-auto max-w-6xl px-5 py-6"}
    (raw-html body)]))

(defn render-breadcrumb-fragment
  "Render breadcrumbs as an HTML fragment for SSE patching.

   Params:
   `breadcrumbs` - Seq of maps with :href and :label.

   Returns:
   HTML string wrapped in a div with id=breadcrumbs."
  [breadcrumbs]
  (render-fragment
   [:div {:id "breadcrumbs" :class "mx-auto max-w-6xl px-5 pt-4 pb-1"}
    (when (seq breadcrumbs)
      (into [:div {:class "flex items-center gap-1.5 text-[12px] text-[var(--muted)]"}]
            (interpose
             [:span "/"]
             (for [{:keys [href label]} breadcrumbs]
               (if href
                 [:a {:href href :class "text-[var(--muted)] hover:text-[var(--accent)] no-underline"} label]
                 [:span {:class "font-medium text-[var(--ink-secondary)]"} label])))))]))

(defn render-topbar-context-fragment
  "Render the topbar organization context fragment for SSE patching.

   Params:
   `content` - Hiccup node or HTML string.

   Returns:
   HTML string wrapped in a div with id=topbar-context."
  [content]
  (render-fragment
   [:div {:id "topbar-context"}
    (raw-html content)]))
