(ns com.blockether.styrmann.presentation.screen.ticket-show
  "SSR ticket detail — warm editorial issue view."
  (:require
   [com.blockether.styrmann.domain.organization :as organization]
   [com.blockether.styrmann.domain.ticket :as ticket]
   [com.blockether.styrmann.presentation.component.layout :as layout]
   [com.blockether.styrmann.presentation.component.task-card :as task-card]
   [com.blockether.styrmann.presentation.component.ui :as ui]))

(defn- criteria-tree [items]
  (when (seq items)
    [:ul {:class "space-y-1.5 pl-5 text-[14px] text-[var(--ink-secondary)] leading-relaxed"}
     (for [{:keys [text children]} items]
       [:li {:class "list-disc marker:text-[var(--line-strong)]"}
        text
        (criteria-tree children)])]))

(defn- detail-row [label content]
  [:div {:class "flex items-start gap-3 py-2.5"}
   [:span {:class "w-28 flex-shrink-0 field-label pt-0.5"} label]
   [:div {:class "flex-1"} content]])

(defn- inline-select-form
  "A select that auto-submits on change."
  [action-url field-name current-value options placeholder]
  [:form {:method "post" :action action-url :class "inline-select-form"}
   [:select {:class "input !py-1.5 !text-[13px] !pr-8 cursor-pointer"
             :name field-name
             :onchange "this.form.submit()"}
    [:option {:value "" :disabled true :selected (nil? current-value)} placeholder]
    (for [{:keys [value label selected?]} options]
      [:option (cond-> {:value value} selected? (assoc :selected true)) label])]])

(defn render
  "Render a ticket detail screen.

   Params:
   `conn` - Datalevin connection.
   `ticket-id` - UUID. Ticket identifier.

   Returns:
   HTML page string."
  [conn ticket-id]
  (if-let [t (ticket/find-by-id conn ticket-id)]
    (let [org-id (get-in t [:ticket/organization :organization/id])
          org-name (get-in t [:ticket/organization :organization/name])
          org-overview (organization/overview conn org-id)
          organizations (organization/list-organizations conn)
          body
          [:div {:class "grid gap-6 lg:grid-cols-[1fr_320px] lg:grid-rows-[auto_1fr]"}
           ;; Status actions — first on mobile, sidebar row 1 on desktop
           (let [status (or (:ticket/status t) :ticket.status/open)
                 closed? (= status :ticket.status/closed)
                 action-url (str "/organizations/" org-id "/tickets/" (:ticket/id t) "/status")]
             [:div {:class "lg:col-start-2 lg:row-start-1"}
              [:div {:class "card p-4"}
               (cond
                 closed?
                 [:form {:method "post" :action action-url}
                  [:input {:type "hidden" :name "status" :value "ticket.status/open"}]
                  [:button {:class "btn-secondary w-full" :type "submit"}
                   [:i {:data-lucide "rotate-ccw" :class "size-4"}]
                   "Reopen ticket"]]

                 (= status :ticket.status/verification)
                 [:div {:class "flex gap-2"}
                  [:form {:method "post" :action action-url :class "flex-1"}
                   [:input {:type "hidden" :name "status" :value "ticket.status/closed"}]
                   [:button {:class "btn-primary w-full" :type "submit"}
                    [:i {:data-lucide "check-circle" :class "size-4"}]
                    "Close ticket"]]
                  [:form {:method "post" :action action-url}
                   [:input {:type "hidden" :name "status" :value "ticket.status/in-progress"}]
                   [:button {:class "btn-secondary !px-3" :type "submit" :title "Back to in progress"}
                    [:i {:data-lucide "rotate-ccw" :class "size-4"}]]]]

                 (= status :ticket.status/in-progress)
                 [:div {:class "flex gap-2"}
                  [:form {:method "post" :action action-url :class "flex-1"}
                   [:input {:type "hidden" :name "status" :value "ticket.status/verification"}]
                   [:button {:class "btn-primary w-full" :type "submit"}
                    [:i {:data-lucide "search-check" :class "size-4"}]
                    "Send to verification"]]
                  [:form {:method "post" :action action-url}
                   [:input {:type "hidden" :name "status" :value "ticket.status/open"}]
                   [:button {:class "btn-secondary !px-3" :type "submit" :title "Back to todo"}
                    [:i {:data-lucide "rotate-ccw" :class "size-4"}]]]]

                 :else
                 [:div {:class "flex gap-2"}
                  [:form {:method "post" :action action-url :class "flex-1"}
                   [:input {:type "hidden" :name "status" :value "ticket.status/in-progress"}]
                   [:button {:class "btn-primary w-full" :type "submit"}
                    [:i {:data-lucide "play" :class "size-4"}]
                    "Start progress"]]
                  [:form {:method "post" :action action-url}
                   [:input {:type "hidden" :name "status" :value "ticket.status/closed"}]
                   [:button {:class "btn-secondary !px-3" :type "submit" :title "Close directly"}
                    [:i {:data-lucide "check-circle" :class "size-4"}]]]])]])
           ;; Main content — spans row 1-2 on desktop
           [:div {:class "space-y-5 lg:col-start-1 lg:row-start-1 lg:row-span-2"}
            [:div
             [:div {:class "flex flex-wrap items-center gap-2 mb-3"}
              (ui/type-badge (:ticket/type t))
              (ui/ticket-status-badge (:ticket/status t))
              (when-let [sprint (:ticket/sprint t)]
                (ui/pill (:sprint/name sprint)))
              (when-let [m (:ticket/milestone t)]
                (ui/pill (:milestone/name m)))]
             [:h1 {:class "text-[24px] sm:text-[28px] leading-tight"}
              (or (:ticket/title t) (:ticket/description t))]
             (when (seq (:ticket/description t))
               [:p {:class "mt-3 text-[15px] leading-relaxed text-[var(--ink-secondary)]"}
                (:ticket/description t)])]
            [:div {:class "card p-5"}
             [:div {:class "field-label mb-3"} "Acceptance Criteria"]
             (if (seq (:ticket/acceptance-criteria t))
               (criteria-tree (:ticket/acceptance-criteria t))
               [:span {:class "text-[13px] text-[var(--muted)]"} "None defined."])]
            (when (seq (:ticket/attachments t))
              [:div {:class "card p-5"}
               [:div {:class "field-label mb-3"} "Attachments"]
               (into [:div {:class "flex flex-wrap gap-2"}]
                     (for [att (:ticket/attachments t)]
                       [:a {:href (str "/attachments/" (:attachment/id att))
                            :class "inline-flex items-center gap-1.5 rounded-xl bg-[var(--cream-dark)] px-3 py-2 text-[13px] text-[var(--ink)] no-underline hover:bg-[var(--line-strong)] transition-colors"}
                        [:i {:data-lucide "paperclip" :class "size-3.5 text-[var(--muted)]"}]
                        (:attachment/name att)]))])
            [:div {:class "card p-5"}
             [:div {:class "flex items-center justify-between mb-4"}
              [:div {:class "flex items-center gap-3"}
               [:div {:class "field-label !mb-0"} "Child tasks"]
               [:span {:class "text-[12px] text-[var(--muted)]"} (str (count (:ticket/tasks t)) " tasks")]]
              [:label {:class "done-toggle" :data-done-toggle "show-done"}
               [:input {:type "checkbox"}]
               [:span "Show done"]]]
             (if (seq (:ticket/tasks t))
               (into [:div {:class "space-y-2"}]
                     (map task-card/view (:ticket/tasks t)))
               [:div {:class "text-[13px] text-[var(--muted)] text-center py-4"}
                "No tasks yet."])]]
           (let [closed? (= (or (:ticket/status t) :ticket.status/open) :ticket.status/closed)]
[:aside {:class "flex flex-col gap-4 lg:col-start-2 lg:row-start-2"}
              ;; Details
              [:div {:class "card p-5"}
               [:div {:class "field-label mb-3"} "Details"]
               (detail-row "Assignee"
                           [:div {:class "flex items-center gap-2"}
                            (ui/avatar (:ticket/assignee t))
                            [:span {:class "text-[14px] font-medium"} (:ticket/assignee t)]])
               (detail-row "Story Points"
                           [:span {:class "text-[16px] font-bold"} (:ticket/story-points t)])
               (detail-row "Effort"
                           [:div {:class "flex items-center gap-3"}
                            [:div {:class "w-24 h-2 rounded-full bg-[var(--cream-dark)] overflow-hidden"}
                             [:div {:class "h-full rounded-full bg-[var(--accent)]"
                                    :style (str "width:" (* 10 (:ticket/effort t)) "%")}]]
                            [:span {:class "text-[12px] text-[var(--muted)]"} (str (:ticket/effort t) "/10")]])
               (detail-row "Impact"
                           [:div {:class "flex items-center gap-3"}
                            [:div {:class "w-24 h-2 rounded-full bg-[var(--cream-dark)] overflow-hidden"}
                             [:div {:class "h-full rounded-full bg-[var(--good)]"
                                    :style (str "width:" (* 10 (:ticket/impact t)) "%")}]]
                            [:span {:class "text-[12px] text-[var(--muted)]"} (str (:ticket/impact t) "/10")]])
               (detail-row "Organization"
                           [:a {:href (str "/organizations/" org-id)} org-name])
               ;; Sprint — inline editable (disabled when closed)
               (detail-row "Sprint"
                           (if closed?
                             [:span {:class "text-[14px]"} (or (get-in t [:ticket/sprint :sprint/name]) "None")]
                             (if (seq (:organization/sprints org-overview))
                               (let [current-sprint-id (get-in t [:ticket/sprint :sprint/id])]
                                 (inline-select-form
                                  (str "/organizations/" org-id "/tickets/" ticket-id "/assign-sprint")
                                  "sprint-id"
                                  current-sprint-id
                                  (for [s (:organization/sprints org-overview)]
                                    {:value (str (:sprint/id s))
                                     :label (:sprint/name s)
                                     :selected? (= (:sprint/id s) current-sprint-id)})
                                  "None"))
                               [:span {:class "text-[13px] text-[var(--muted)]"} "No sprints"])))
               ;; Milestone — inline editable (disabled when closed)
               (let [milestones (mapcat (fn [s] (map #(assoc % :_sprint-name (:sprint/name s))
                                                     (:sprint/milestones s)))
                                        (:organization/sprints org-overview))]
                 (detail-row "Milestone"
                             (if closed?
                               [:span {:class "text-[14px]"} (or (get-in t [:ticket/milestone :milestone/name]) "None")]
                               (if (seq milestones)
                                 (let [current-milestone-id (get-in t [:ticket/milestone :milestone/id])]
                                   (inline-select-form
                                    (str "/organizations/" org-id "/tickets/" ticket-id "/assign-milestone")
                                    "milestone-id"
                                    current-milestone-id
                                    (for [m milestones]
                                      {:value (str (:milestone/id m))
                                       :label (str (:_sprint-name m) " / " (:milestone/name m))
                                       :selected? (= (:milestone/id m) current-milestone-id)})
                                    "None"))
                                 [:span {:class "text-[13px] text-[var(--muted)]"} "No milestones"]))))]
              ;; Add task — modal popup (hidden when closed)
              (when (and (not closed?) (seq (:organization/workspaces org-overview)))
                [:button {:type "button"
                          :class "btn-primary w-full"
                          :data-modal-open (str "modal-add-task-" ticket-id)}
                 [:i {:data-lucide "plus" :class "size-4"}]
                 "Add task"])])
           ;; Add task modal
           (when (and (not (= :ticket.status/closed (or (:ticket/status t) :ticket.status/open)))
                      (seq (:organization/workspaces org-overview)))
             [:div {:id (str "modal-add-task-" ticket-id) :class "modal-backdrop" :role "dialog" :aria-modal "true"}
              [:div {:class "modal-shell"}
               [:div {:class "flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4"}
                [:div
                 [:div {:class "field-label mb-1"} "Task"]
                 [:h2 {:class "text-[24px] leading-none"} "Add task"]]
                [:button {:type "button" :class "toolbar-action !px-3 !py-2" :data-modal-close true}
                 [:i {:data-lucide "x" :class "size-4"}]]]
               [:div {:class "px-5 py-5"}
                [:form {:class "space-y-4" :method "post"
                        :action (str "/organizations/" org-id "/tickets/" ticket-id "/tasks")}
                 [:label {:class "block"}
                  [:span {:class "field-label"} "Workspace"]
                  [:select {:class "input" :name "workspace-id" :required true}
                   [:option {:value ""} "Select workspace"]
                   (for [ws (:organization/workspaces org-overview)]
                     [:option {:value (:workspace/id ws)} (:workspace/name ws)])]]
                 [:label {:class "block"}
                  [:span {:class "field-label"} "Task description"]
                  [:textarea {:class "input" :name "description" :rows 3
                              :placeholder "Describe the execution scope" :required true}]]
                 [:div {:class "flex justify-end"}
                  [:button {:class "btn-primary" :type "submit"}
                   [:i {:data-lucide "plus" :class "size-4"}]
                   "Create task"]]]]]])]]
      (layout/page "Ticket" body
                   {:breadcrumbs [{:href "/" :label "Organizations"}
                                  {:href (str "/organizations/" org-id) :label org-name}
                                  {:label (let [title (or (:ticket/title t) (:ticket/description t))]
                                            (subs title 0 (min 40 (count title))))}]
                    :topbar-context (layout/render-fragment (ui/org-topbar-dropdown organizations org-overview))}))
    (layout/page "Not found" [:p "Ticket not found."])))
