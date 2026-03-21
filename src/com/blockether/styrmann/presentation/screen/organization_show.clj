(ns com.blockether.styrmann.presentation.screen.organization-show
  "SSR organization screen — clean board-first layout."
  (:require
   [com.blockether.styrmann.domain.organization :as organization]
   [com.blockether.styrmann.i18n :as i18n]
   [com.blockether.styrmann.presentation.component.layout :as layout]
   [com.blockether.styrmann.presentation.component.notification-list :as notification-list]
   [com.blockether.styrmann.presentation.component.ticket-card :as ticket-card]
   [com.blockether.styrmann.presentation.component.ui :as ui]))

(defn- org-topbar-context [organizations org]
  (ui/org-topbar-dropdown organizations org))

(defn- sprint-ticket-count [sprint]
  (+ (count (:sprint/direct-tickets sprint))
     (reduce + 0 (map #(count (:milestone/tickets %)) (:sprint/milestones sprint)))))

;; -- Toolbar -----------------------------------------------------------------

(defn- toolbar []
  [:div {:class "card p-2.5 sm:p-3 mb-4"}
   [:div {:class "flex flex-wrap items-center justify-between gap-2"}
    ;; Tabs
    [:div {:class "flex gap-1.5"}
     [:button {:type "button" :class "toolbar-tab is-active" :data-view-tab "board"} "Sprint board"]
     [:button {:type "button" :class "toolbar-tab" :data-view-tab "backlog"} "Backlog"]]
    ;; Actions — on the right
    [:div {:class "flex flex-wrap justify-end gap-1.5 ml-auto"}
     [:button {:type "button" :class "toolbar-action !py-2 !px-3 !text-[12px]" :data-modal-open "modal-ticket"}
      [:i {:data-lucide "ticket" :class "size-3.5 text-[var(--accent)]"}]
      [:span {:class "hidden sm:inline"} "Ticket"]]
     [:button {:type "button" :class "toolbar-action !py-2 !px-3 !text-[12px]" :data-modal-open "modal-sprint"}
      [:i {:data-lucide "zap" :class "size-3.5 text-[var(--accent)]"}]
      [:span {:class "hidden sm:inline"} "Sprint"]]
     [:button {:type "button" :class "toolbar-action !py-2 !px-3 !text-[12px]" :data-modal-open "modal-milestone"}
      [:i {:data-lucide "flag" :class "size-3.5 text-[var(--accent)]"}]
      [:span {:class "hidden sm:inline"} "Milestone"]]
     [:button {:type "button" :class "toolbar-action !py-2 !px-3 !text-[12px]" :data-modal-open "modal-workspace"}
      [:i {:data-lucide "git-branch" :class "size-3.5 text-[var(--accent)]"}]
      [:span {:class "hidden sm:inline"} "Workspace"]]]]])

;; -- Kanban board ------------------------------------------------------------

(defn- closed-toggle [target-class label]
  [:label {:class "done-toggle" :data-done-toggle target-class}
   [:input {:type "checkbox"}]
   [:span label]])

(def ^:private status-columns
  "Status column definitions: [keyword label icon]."
  [[:ticket.status/open        "Inbox"        "inbox"]
   [:ticket.status/in-progress "In Progress"  "loader"]
   [:ticket.status/verification "Verification" "eye"]
   [:ticket.status/closed      "Done"         "check-circle"]])

(defn- tickets-by-status
  "Group tickets into [inbox in-progress verification done] vectors."
  [tickets]
  (let [grouped (group-by #(or (:ticket/status %) :ticket.status/open) tickets)]
    (mapv (fn [[k _ _]] (get grouped k [])) status-columns)))

(defn- status-col-header
  "Render a status column header with icon, label, and count."
  [label icon cnt]
  [:div {:class "flex items-center gap-1.5 px-1 pb-1"}
   [:i {:data-lucide icon :class "size-3 text-[var(--muted)]"}]
   [:span {:class "text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]"} label]
   (when (pos? cnt)
     [:span {:class "ml-auto rounded-full bg-[var(--cream-dark)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--muted)] leading-none"} cnt])])

(defn- status-column-cards
  "Render a list of ticket cards for a status column."
  [status-kw tickets]
  [:div {:class "drop-zone min-h-[48px] rounded-lg p-1 transition-colors"
         :data-drop-status (name status-kw)}
   (if (seq tickets)
     (into [:div {:class "space-y-2"}]
           (map ticket-card/board-card tickets))
     [:div {:class "py-3 text-[12px] text-[var(--muted)] italic text-center"} "—"])])

;; -- Desktop: milestone rows (hidden on mobile) ----------------------------

(defn- desktop-milestone-row
  "Render a milestone row for desktop: label + 4 status columns."
  [label tickets]
  (let [buckets (tickets-by-status tickets)]
    [:div {:class "flex gap-3 py-2 border-b border-[var(--line)] last:border-b-0"}
     [:div {:class "w-36 flex-shrink-0 pt-1"}
      [:span {:class "text-[13px] font-semibold text-[var(--ink)] leading-tight"} label]
      [:div {:class "text-[11px] text-[var(--muted)] mt-0.5"} (i18n/t :n/ticket (count tickets))]]
     [:div {:class "flex-1 grid grid-cols-4 gap-3"}
      (for [[bucket [status-kw _ _]] (map vector buckets status-columns)]
        (status-column-cards status-kw bucket))]]))

(defn- desktop-board
  "Render the desktop board for a sprint: column headers + milestone rows."
  [sprint]
  (let [milestones (:sprint/milestones sprint)
        direct-tickets (:sprint/direct-tickets sprint)
        all-rows   (cond-> (into []
                                 (for [m milestones]
                                   {:label (:milestone/name m) :tickets (:milestone/tickets m)}))
                     (seq direct-tickets)
                     (conj {:label "Unassigned" :tickets direct-tickets}))]
    [:div {:class "hidden sm:block"}
     ;; Column headers
     [:div {:class "flex gap-3 mb-2"}
      [:div {:class "w-36 flex-shrink-0"}]
      [:div {:class "flex-1 grid grid-cols-4 gap-3"}
       (for [[idx [_ label icon]] (map-indexed vector status-columns)]
         (let [cnt (reduce + 0 (map (fn [{:keys [tickets]}]
                                      (count (nth (tickets-by-status tickets) idx)))
                                    all-rows))]
           (status-col-header label icon cnt)))]]
     ;; Milestone rows
     (if (seq all-rows)
       (into [:div {:class "card-sm divide-y divide-[var(--line)] px-3"}]
             (for [{:keys [label tickets]} all-rows]
               (desktop-milestone-row label tickets)))
       [:div {:class "py-4 text-[12px] text-[var(--muted)] italic text-center"} "No tickets assigned"])]))

;; -- Mobile: milestone sections (hidden on desktop) -------------------------

(defn- mobile-milestone-section
  "Render a milestone as a collapsible mobile section with stacked status groups."
  [label tickets]
  (let [buckets (tickets-by-status tickets)]
    [:details {:class "card-sm overflow-hidden" :open true}
     [:summary {:class "flex items-center justify-between gap-2 px-4 py-3 cursor-pointer select-none bg-[var(--cream-dark)]"}
      [:div {:class "flex items-center gap-2 min-w-0"}
       [:i {:data-lucide "flag" :class "size-3.5 text-[var(--accent)] flex-shrink-0"}]
       [:span {:class "text-[13px] font-semibold text-[var(--ink)] truncate"} label]]
      [:div {:class "flex items-center gap-2 flex-shrink-0"}
       [:span {:class "text-[11px] text-[var(--muted)]"} (str (count tickets))]
       [:i {:data-lucide "chevron-down" :class "size-3.5 text-[var(--muted)] transition-transform [[open]>&]:rotate-180"}]]]
     [:div {:class "divide-y divide-[var(--line)]"}
      (for [[bucket [status-kw label icon]] (map vector buckets status-columns)]
        [:div {:class "px-3 py-3 drop-zone" :data-drop-status (name status-kw)}
         [:div {:class "flex items-center gap-1.5 mb-2"}
          [:i {:data-lucide icon :class "size-3 text-[var(--muted)]"}]
          [:span {:class "text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]"} label]
          [:span {:class "ml-1 text-[10px] text-[var(--muted)]"} (str "(" (count bucket) ")")]]
         (if (seq bucket)
           (into [:div {:class "space-y-2"}]
                 (map ticket-card/board-card bucket))
           [:div {:class "py-2 text-[12px] text-[var(--muted)] italic text-center"} "—"])])]]))

(defn- mobile-board
  "Render the mobile board for a sprint: stacked milestone sections."
  [sprint]
  (let [milestones (:sprint/milestones sprint)
        direct-tickets (:sprint/direct-tickets sprint)]
    [:div {:class "sm:hidden space-y-3"}
     (for [m milestones]
       (mobile-milestone-section (:milestone/name m) (:milestone/tickets m)))
     (when (seq direct-tickets)
       (mobile-milestone-section "Unassigned" direct-tickets))
     (when (and (empty? milestones) (empty? direct-tickets))
       [:div {:class "py-4 text-[12px] text-[var(--muted)] italic text-center"} "No tickets assigned"])]))

;; -- Board section ----------------------------------------------------------

(defn- board-section [org]
  (let [sprints (:organization/sprints org)]
    [:section {:id "board-view" :class "view-panel" :data-view-panel "board"}
     [:div {:class "flex items-center justify-between mb-3"}
      [:span {:class "text-[13px] font-semibold text-[var(--muted)] uppercase tracking-wider"} "Board"]
      (closed-toggle "show-closed" "Show closed")]
     (if (seq sprints)
       (into [:div {:class "space-y-6"}]
             (for [sprint sprints]
               [:div
                [:div {:class "flex items-center gap-2 mb-3"}
                 [:i {:data-lucide "zap" :class "size-3.5 text-[var(--accent)]"}]
                 [:span {:class "text-[14px] font-semibold text-[var(--ink)]"} (:sprint/name sprint)]
                 (ui/pill (i18n/t :n/ticket (sprint-ticket-count sprint)))]
                (desktop-board sprint)
                (mobile-board sprint)]))
       (ui/empty-state "No sprints yet." "mt-2"))]))

;; -- Backlog -----------------------------------------------------------------

(defn- backlog-section [org]
  [:section {:id "backlog-view" :class "view-panel" :data-view-panel "backlog" :hidden true}
   [:div {:class "flex items-center justify-between mb-3"}
    [:span {:class "text-[13px] font-semibold text-[var(--muted)] uppercase tracking-wider"}
     (str "Backlog (" (count (:organization/backlog org)) ")")]
    (closed-toggle "show-closed" "Show closed")]
   (if (seq (:organization/backlog org))
     (into [:div {:class "space-y-2"}]
           (map ticket-card/board-card (:organization/backlog org)))
     (ui/empty-state "Backlog is empty."))])

;; -- Activity (collapsible) --------------------------------------------------

(defn- activity-section [org]
  [:details {:class "mt-6 group"}
   [:summary {:class "flex items-center gap-2 cursor-pointer text-[12px] font-semibold text-[var(--muted)] uppercase tracking-wider select-none hover:text-[var(--ink)] transition-colors"}
    [:i {:data-lucide "activity" :class "size-3.5"}]
    "Activity"
    [:i {:data-lucide "chevron-down" :class "size-3.5 ml-auto transition-transform group-open:rotate-180"}]]
   [:div {:class "mt-3"}
    (notification-list/view (:organization/notifications org))]])

;; -- Modals ------------------------------------------------------------------

(defn- text-field [label input-name placeholder]
  [:label {:class "block"}
   [:span {:class "field-label"} label]
   [:input {:class "input" :type "text" :name input-name :placeholder placeholder :required true}]])

(defn- number-field [label input-name value min-val max-val]
  (let [attrs (cond-> {:class "input" :type "number" :name input-name :min min-val :value value :required true}
                max-val (assoc :max max-val))]
    [:label {:class "block"}
     [:span {:class "field-label"} label]
     [:input attrs]]))

(defn- select-field [label input-name options]
  [:label {:class "block"}
   [:span {:class "field-label"} label]
   (into [:select {:class "input" :name input-name :required true}
          [:option {:value ""} (str "Select " (.toLowerCase ^String label))]]
         options)])

(defn- modal-shell [modal-id title subtitle body]
  [:div {:id modal-id :class "modal-backdrop" :role "dialog" :aria-modal "true"}
   [:div {:class "modal-shell"}
    [:div {:class "flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4"}
     [:div
      [:div {:class "field-label mb-1"} subtitle]
      [:h2 {:class "text-[24px] leading-none"} title]]
     [:button {:type "button" :class "modal-close" :data-modal-close true}
      [:i {:data-lucide "x" :class "size-4"}]]]
    [:div {:class "px-5 py-5"} body]]])

(defn- modal-layer [organization-id org]
  [:div
   (modal-shell
    "modal-sprint" "Create sprint" "Planning"
    [:form {:class "space-y-4" :method "post" :action (str "/organizations/" organization-id "/sprints")}
     (text-field "Sprint name" "name" "Sprint 1")
     [:div {:class "flex justify-end"}
      [:button {:class "btn-primary" :type "submit"} "Create sprint"]]])
   (modal-shell
    "modal-milestone" "Create milestone" "Planning"
    (if (seq (:organization/sprints org))
      [:form {:class "space-y-4" :method "post" :action (str "/organizations/" organization-id "/milestones")}
       (select-field "Sprint" "sprint-id"
                     (for [s (:organization/sprints org)]
                       [:option {:value (:sprint/id s)} (:sprint/name s)]))
       (text-field "Milestone name" "name" "Milestone A")
       [:div {:class "flex justify-end"}
        [:button {:class "btn-primary" :type "submit"} "Create milestone"]]]
      (ui/empty-state "Create a sprint first.")))
   (modal-shell
    "modal-workspace" "Register workspace" "Execution"
    [:form {:class "space-y-4" :method "post" :action (str "/organizations/" organization-id "/workspaces")}
     (text-field "Workspace name" "name" "styrmann")
     (text-field "Repository" "repository" "https://github.com/...")
     [:div {:class "flex justify-end"}
      [:button {:class "btn-primary" :type "submit"} "Register workspace"]]])
   (modal-shell
    "modal-ticket" "Add backlog ticket" "Backlog"
    [:form {:id "ticket-form" :class "space-y-4" :method "post" :action (str "/organizations/" organization-id "/tickets") :enctype "multipart/form-data"}
     (text-field "Title" "title" "Short ticket title")
     [:div {:class "grid grid-cols-1 sm:grid-cols-2 gap-4"}
      (select-field "Type" "type"
                    [[:option {:value "ticket.type/feature"} "Feature"]
                     [:option {:value "ticket.type/bug"} "Bug"]
                     [:option {:value "ticket.type/chore"} "Chore"]
                     [:option {:value "ticket.type/docs"} "Docs"]
                     [:option {:value "ticket.type/spike"} "Spike"]])
      (text-field "Assignee" "assignee" "alex")]
     [:label {:class "block"}
      [:span {:class "field-label"} "Description"]
      [:textarea {:class "input" :name "description" :placeholder "Detailed description (optional)" :rows 3}]]
     [:div
      [:span {:class "field-label"} "Acceptance criteria"]
      [:div {:id "ac-builder" :class "mt-2 space-y-2"}]
      [:div {:class "flex items-center gap-2 mt-2"}
       [:input {:id "ac-new-input" :class "input flex-1" :type "text" :placeholder "Add acceptance criterion..." :autocomplete "off"}]
       [:button {:type "button" :class "btn-primary !px-3 !py-2.5" :id "ac-add-btn"}
        [:i {:data-lucide "plus" :class "size-4"}]]]
      [:input {:type "hidden" :name "acceptance-criteria-text" :id "ac-hidden-field"}]]
     [:div {:class "grid grid-cols-3 gap-4"}
      (number-field "Story points" "story-points" 3 0 nil)
      (number-field "Effort (0-10)" "effort" 3 0 10)
      (number-field "Impact (0-10)" "impact" 7 0 10)]
     [:label {:class "block"}
      [:span {:class "field-label"} "Attachments"]
      [:input {:class "input" :type "file" :name "attachments" :multiple true}]]
     [:div {:class "flex justify-end"}
      [:button {:class "btn-primary" :type "submit"} "Create ticket"]]])])

;; -- Page assembly -----------------------------------------------------------

(defn- body-content [_organizations org organization-id]
  [:div {:data-view-root true :data-view-default "board"}
   (toolbar)
   (board-section org)
   (backlog-section org)
   (activity-section org)
   (modal-layer organization-id org)])

(defn render
  "Render an organization screen.

   Params:
   `conn` - Datalevin connection.
   `organization-id` - UUID. Organization identifier.

   Returns:
   HTML page string."
  [conn organization-id]
  (if-let [org (organization/overview conn organization-id)]
    (let [organizations (organization/list-organizations conn)]
      (layout/page (:organization/name org)
                   (body-content organizations org organization-id)
                   {:topbar-context (layout/render-fragment (org-topbar-context organizations org))}))
    (layout/page "Not found" [:p "Organization not found."])))

(defn render-body
  "Render only the organization body fragment for SSE patching.

   Params:
   `conn` - Datalevin connection.
   `organization-id` - UUID. Organization identifier.

   Returns:
   Map with :body-html and :breadcrumbs, or nil."
  [conn organization-id]
  (when-let [org (organization/overview conn organization-id)]
    (let [organizations (organization/list-organizations conn)]
      {:body-html (layout/render-fragment (body-content organizations org organization-id))
       :breadcrumbs []
       :topbar-context (layout/render-fragment (org-topbar-context organizations org))})))
