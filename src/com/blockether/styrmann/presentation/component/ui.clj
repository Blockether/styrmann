(ns com.blockether.styrmann.presentation.component.ui
  "Reusable Hiccup UI helpers — warm editorial design."
  (:require
   [clojure.string :as str]))

;; -- Badges ------------------------------------------------------------------

(def ^:private type-badge-class
  {:ticket.type/feature "badge-feature"
   :ticket.type/bug     "badge-bug"
   :ticket.type/chore   "badge-chore"
   :ticket.type/docs    "badge-docs"
   :ticket.type/spike   "badge-spike"})

(def ^:private status-badge-class
  {:task.status/inbox        "badge-inbox"
   :task.status/implementing "badge-implementing"
   :task.status/testing      "badge-testing"
   :task.status/reviewing    "badge-reviewing"
   :task.status/done         "badge-done"})

(defn type-badge
  "Render a ticket type badge.

   Params:
   `ticket-type` - Keyword. Ticket type.

   Returns:
   Hiccup node."
  [ticket-type]
  [:span {:class (str "badge " (get type-badge-class ticket-type "badge-inbox"))}
   (some-> ticket-type name)])

(defn status-badge
  "Render a task status badge.

   Params:
   `status` - Keyword. Task status.

   Returns:
   Hiccup node."
  [status]
  [:span {:class (str "badge " (get status-badge-class status "badge-inbox"))}
   (some-> status name (str/replace "-" " "))])

(def ^:private ticket-status-badge-class
  {:ticket.status/open         "badge-inbox"
   :ticket.status/in-progress  "badge-implementing"
   :ticket.status/verification "badge-reviewing"
   :ticket.status/closed       "badge-done"})

(defn ticket-status-badge
  "Render a ticket status badge.

   Params:
   `status` - Keyword. Ticket status.

   Returns:
   Hiccup node."
  [status]
  (let [s (or status :ticket.status/open)]
    [:span {:class (str "badge " (get ticket-status-badge-class s "badge-inbox"))}
     (some-> s name (str/replace "-" " "))]))

(defn avatar
  "Render a user avatar circle.

   Params:
   `name-str` - String. User name.

   Returns:
   Hiccup node."
  [name-str]
  (let [initial (str/upper-case (subs (or name-str "?") 0 1))]
    [:span {:class "avatar" :title name-str} initial]))

(defn pill
  "Render a subtle label pill.

   Params:
   `text` - String. Pill contents.
   `classes` - String. Extra classes.

   Returns:
   Hiccup node."
  ([text] (pill text ""))
  ([text classes]
   [:span {:class (str "inline-flex items-center rounded-md bg-[var(--cream-dark)] px-2.5 py-1 text-[11px] font-medium text-[var(--ink-secondary)] " classes)} text]))

;; -- Metric cards ------------------------------------------------------------

(defn metric-card
  "Render a stat card.

   Params:
   `label` - String. Metric label.
   `value` - Displayable. Metric value.
   `value-classes` - String. Extra classes for value.

   Returns:
   Hiccup node."
  ([label value] (metric-card label value "text-2xl"))
  ([label value value-classes]
   [:div {:class "rounded-2xl bg-[var(--cream-dark)] p-4"}
    [:div {:class "field-label"} label]
    [:div {:class (str "mt-1 font-bold text-[var(--ink)] " value-classes)} value]]))

;; -- Section headings --------------------------------------------------------

(defn section-heading
  "Render a section heading.

   Params:
   `opts` - Map with `:title`, optional `:count`, optional `:description`.

   Returns:
   Hiccup node."
  [{:keys [title count description]}]
  [:div {:class "flex items-center justify-between"}
   [:div {:class "flex items-center gap-3"}
    [:h2 {:class "text-[20px]"} title]
    (when count
      [:span {:class "rounded-full bg-[var(--cream-dark)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--muted)]"}
       count])]
   (when description
     [:span {:class "text-[13px] text-[var(--muted)]"} description])])

;; -- Empty states ------------------------------------------------------------

(defn empty-state
  "Render an empty state message.

   Params:
   `message` - String. Message text.

   Returns:
   Hiccup node."
  ([message] (empty-state message ""))
  ([message extra-classes]
   [:div {:class (str "rounded-2xl border-2 border-dashed border-[var(--line-strong)] bg-[var(--cream-dark)] px-6 py-8 text-center text-[14px] text-[var(--muted)] " extra-classes)}
    message]))

;; -- Board column (Trello-style, mobile-responsive) -------------------------

(defn board-column
  "Render a board column.

   Params:
   `title` - String. Column heading.
   `count-n` - Integer. Item count.
   `cards` - Seq of Hiccup nodes.

   Returns:
   Hiccup node."
  [title count-n cards]
  [:div {:class "min-w-[280px] max-w-[320px] flex-shrink-0 flex flex-col rounded-2xl bg-[var(--cream-dark)] p-2"}
   [:div {:class "flex items-center justify-between px-2 py-2"}
    [:span {:class "text-[12px] font-semibold uppercase tracking-wider text-[var(--muted)]"} title]
    [:span {:class "rounded-full bg-[var(--surface)] px-2 py-0.5 text-[11px] font-bold text-[var(--ink-secondary)] shadow-sm"} count-n]]
   (if (seq cards)
     (into [:div {:class "flex-1 space-y-2 overflow-y-auto pt-1"}] cards)
     [:div {:class "px-2 py-4 text-[12px] text-[var(--muted)] italic text-center"} "No items"])])

;; -- Board card --------------------------------------------------------------

(defn board-card-node
  "Render a board card for columns.

   Params:
   `opts` - Map with `:href`, `:title`, `:badges`, optional `:description`,
            optional `:assignee`, optional `:footer`.

   Returns:
   Hiccup node."
  [{:keys [href title title-class badges description assignee footer wrapper-attrs]}]
  [:a (merge {:href href :class "board-card block no-underline text-[var(--ink)]"}
             wrapper-attrs)
   (when (seq badges)
     (into [:div {:class "flex flex-wrap gap-1 mb-2"}]
           (remove nil? badges)))
   [:div {:class (str "text-[13px] font-medium leading-snug " (or title-class "ticket-title"))} title]
   (when (seq description)
     [:p {:class "mt-2 text-[12px] leading-relaxed text-[var(--muted)]"} description])
   (when (or assignee footer)
     [:div {:class "mt-2.5 flex items-center justify-between"}
      (or footer [:span])
      (when assignee (avatar assignee))])])

;; -- Info card ---------------------------------------------------------------

(defn info-card
  "Render an information card.

   Params:
   `title` - String. Card title.
   `description` - String. Supporting copy.

   Returns:
   Hiccup node."
  [title description]
  [:div {:class "card-sm p-4"}
   [:div {:class "text-[13px] font-semibold text-[var(--ink)]"} title]
   [:p {:class "mt-1 text-[12px] text-[var(--muted)]"} description]])

;; -- Status callout ----------------------------------------------------------

(defn status-callout
  "Render a status callout box.

   Params:
   `opts` - Map with `:label`, `:detail`, `:classes`.

   Returns:
   Hiccup node."
  [{:keys [label detail classes]}]
  [:div {:class (str "rounded-2xl border p-5 " classes)}
   [:div {:class "text-[14px] font-bold"} label]
   [:p {:class "mt-1 text-[13px]"} detail]])

;; -- Tab links ---------------------------------------------------------------

(defn tab-link
  "Render a tab nav link.

   Params:
   `label` - String. Tab label.
   `href` - String. Target.
   `active?` - Boolean.

   Returns:
   Hiccup node."
  [label href active?]
  [:a {:href href
       :class (str "px-3 py-2 text-[13px] font-medium rounded-lg transition-colors no-underline "
                   (if active?
                     "bg-[var(--charcoal)] text-white"
                     "text-[var(--ink-secondary)] hover:bg-[var(--cream-dark)]"))}
   label])

;; -- Numbered step -----------------------------------------------------------

(defn numbered-step
  "Render a numbered process step.

   Params:
   `n` - Integer. Step number.
   `title` - String. Step title.
   `description` - String. Supporting copy.

   Returns:
   Hiccup node."
  [n title description]
  [:div {:class "flex gap-3 items-start"}
   [:span {:class "flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-[var(--accent)] text-white text-[11px] font-bold"} n]
   [:div
    [:div {:class "text-[13px] font-semibold text-[var(--ink)]"} title]
    [:div {:class "text-[12px] text-[var(--muted)]"} description]]])

;; -- Organization topbar dropdown -------------------------------------------

(defn org-topbar-dropdown
  "Render the organization dropdown for the topbar.

   Params:
   `organizations` - Seq of organization maps.
   `org` - Current organization map.

   Returns:
   Hiccup node."
  [organizations org]
  (let [layout-ns (requiring-resolve 'com.blockether.styrmann.presentation.component.layout/nav-attrs)]
    [:div {:class "topbar-menu"}
     [:button {:type "button" :class "org-chip" :data-topbar-toggle true}
      [:span {:class "org-chip-mark"} (subs (:organization/name org) 0 1)]
      [:div {:class "flex flex-col items-start gap-0.5 leading-tight"}
       [:span {:class "text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] font-semibold"} "Organization"]
       [:span {:class "text-[13px] font-semibold text-[var(--ink)]"} (:organization/name org)]]
      [:i {:data-lucide "chevron-down" :class "size-4 text-[var(--muted)]"}]]
     [:div {:class "topbar-menu-panel"}
      [:a {:href (str "/organizations/" (:organization/id org) "/settings")
           :class "topbar-menu-link"}
       [:i {:data-lucide "settings-2" :class "size-4 text-[var(--muted)]"}]
       [:span "Go to settings"]]
      [:div {:class "my-2 h-px bg-[var(--line)]"}]
      (into [:div {:class "space-y-1"}]
            (for [candidate organizations]
              [:a (merge {:class "topbar-menu-link"}
                         (layout-ns (str "/organizations/" (:organization/id candidate))
                                    (str "/fragments/organizations/" (:organization/id candidate))))
               [:span {:class "org-chip-mark !w-6 !h-6 !text-[13px]"}
                (subs (:organization/name candidate) 0 1)]
               [:div {:class "flex flex-col items-start"}
                [:span {:class "text-[13px] font-medium"} (:organization/name candidate)]
                (when (:organization/default? candidate)
                  [:span {:class "text-[10px] uppercase tracking-[0.12em] text-[var(--accent)] font-semibold"}
                   "Default"])]]))]]))
