(ns com.blockether.styrmann.presentation.component.ticket-card
  "Reusable SSR ticket card — warm editorial style."
  (:require
   [com.blockether.styrmann.presentation.component.layout :as layout]
   [com.blockether.styrmann.presentation.component.ui :as ui]))

(defn- criteria-node [items]
  (when (seq items)
    [:ul {:class "mt-2 space-y-1 pl-4 text-[13px] text-[var(--ink-secondary)] leading-relaxed"}
     (for [{:keys [text children]} items]
       [:li {:class "list-disc marker:text-[var(--line-strong)]"}
        [:span text]
        (criteria-node children)])]))

(defn board-card
  "Render a ticket as a board card.

   Params:
   `ticket` - Ticket read model.

   Returns:
   Hiccup node."
  [ticket]
  (let [closed?         (= :ticket.status/closed (:ticket/status ticket))
        organization-id (get-in ticket [:ticket/organization :organization/id])
        ticket-id       (:ticket/id ticket)
        status          (or (:ticket/status ticket) :ticket.status/open)
        drag-attrs      {:draggable         "true"
                         :data-ticket-id    (str ticket-id)
                         :data-ticket-org   (str organization-id)
                         :data-ticket-status (name status)}]
    (ui/board-card-node
     (cond-> {:href (str "/organizations/" organization-id "/tickets/" ticket-id)
              :title-class (when closed? "ticket-title")
              :title (or (:ticket/title ticket) (:ticket/description ticket))
              :badges [(ui/type-badge (:ticket/type ticket))
                       (ui/ticket-status-badge status)
                       (when-let [m (:ticket/milestone ticket)]
                         (ui/pill (:milestone/name m)))]
              :assignee (:ticket/assignee ticket)
              :footer [:div {:class "flex items-center gap-2 text-[11px] text-[var(--muted)]"}
                       [:span (str (:ticket/story-points ticket) " pts")]
                       [:span {:class "w-1 h-1 rounded-full bg-[var(--line-strong)]"}]
                       [:span (str "E" (:ticket/effort ticket))]
                       [:span {:class "w-1 h-1 rounded-full bg-[var(--line-strong)]"}]
                       [:span (str "I" (:ticket/impact ticket))]]}
       true    (assoc :wrapper-attrs (cond-> drag-attrs
                                       closed? (assoc :data-closed "1")))))))

(defn view
  "Render a full ticket row.

   Params:
   `ticket` - Ticket read model.

   Returns:
   Hiccup node."
  [ticket]
  (let [closed? (= :ticket.status/closed (:ticket/status ticket))]
    [:div (cond-> {:class "card-sm p-4 hover:shadow-md transition-shadow"}
            closed? (assoc :data-closed "1"))
     [:div {:class "flex items-start justify-between gap-3"}
      [:div {:class "min-w-0 flex-1"}
       [:div {:class "flex flex-wrap items-center gap-2 mb-1.5"}
        (ui/type-badge (:ticket/type ticket))
        (when-let [sprint (:ticket/sprint ticket)]
          (ui/pill (:sprint/name sprint)))
        (when-let [milestone (:ticket/milestone ticket)]
          (ui/pill (:milestone/name milestone)))]
       [:a {:href (str "/organizations/" (get-in ticket [:ticket/organization :organization/id]) "/tickets/" (:ticket/id ticket))
            :class "text-[14px] font-medium text-[var(--ink)] no-underline hover:text-[var(--accent)]"}
        (or (:ticket/title ticket) (:ticket/description ticket))]
       (when (seq (:ticket/description ticket))
         [:p {:class "mt-1 text-[12px] text-[var(--muted)] line-clamp-2"} (:ticket/description ticket)])]
      [:div {:class "flex items-center gap-3 flex-shrink-0"}
       [:div {:class "hidden sm:flex items-center gap-2 text-[11px] text-[var(--muted)]"}
        [:span (str (:ticket/story-points ticket) " pts")]
        [:span {:class "w-1 h-1 rounded-full bg-[var(--line-strong)]"}]
        [:span (str "E" (:ticket/effort ticket))]
        [:span {:class "w-1 h-1 rounded-full bg-[var(--line-strong)]"}]
        [:span (str "I" (:ticket/impact ticket))]]
       (ui/avatar (:ticket/assignee ticket))]]
     (criteria-node (:ticket/acceptance-criteria ticket))
     (when (seq (:ticket/attachments ticket))
       (into [:div {:class "mt-2 flex flex-wrap gap-1.5"}]
             (map (fn [att]
                    [:a {:href (str "/attachments/" (:attachment/id att))
                         :class "inline-flex items-center gap-1 rounded-md bg-[var(--cream-dark)] px-2 py-1 text-[11px] text-[var(--ink-secondary)] no-underline hover:bg-[var(--line-strong)] transition-colors"}
                     [:i {:data-lucide "paperclip" :class "size-3"}]
                     (:attachment/name att)]))
             (:ticket/attachments ticket)))]))

(defn render
  "Render a ticket card.

   Params:
   `ticket` - Ticket read model.

   Returns:
   HTML string."
  [ticket]
  (layout/render-fragment (view ticket)))
