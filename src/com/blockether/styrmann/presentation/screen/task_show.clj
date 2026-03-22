(ns com.blockether.styrmann.presentation.screen.task-show
  "SSR task detail — warm editorial view."
  (:require
   [clojure.edn :as edn]
   [clojure.string :as str]
   [com.blockether.styrmann.db.git :as db.git]
   [com.blockether.styrmann.db.organization :as db.organization]
   [com.blockether.styrmann.db.task :as db.task]
   [com.blockether.styrmann.domain.organization :as organization]
   [com.blockether.styrmann.execution.session :as session]
   [com.blockether.styrmann.presentation.component.git-progress :as git-progress]
   [com.blockether.styrmann.i18n :as i18n]
   [com.blockether.styrmann.presentation.component.layout :as layout]
   [com.blockether.styrmann.presentation.component.ui :as ui]
   [datalevin.core :as d]
   [nextjournal.markdown :as md]
   [starfederation.datastar.clojure.api :as d*]))

(def ^:private next-statuses
  {:task.status/inbox        [:task.status/implementing]
   :task.status/implementing [:task.status/testing]
   :task.status/testing      [:task.status/reviewing]
   :task.status/reviewing    [:task.status/done]
   :task.status/done         [:task.status/inbox]})

(defn- status-label [status]
  (-> status name (str/replace "-" " ") str/capitalize))

(defn- detail-row [label content]
  [:div {:class "flex items-start gap-3 py-2.5 border-b border-[var(--line)] last:border-b-0"}
   [:span {:class "w-24 flex-shrink-0 field-label pt-0.5"} label]
   [:div {:class "flex-1"} content]])

(defn- event-type-icon [event-type]
  (case event-type
    :session.event.type/call-start  [:i {:data-lucide "play" :class "size-3 text-[#6b9fff]"}]
    :session.event.type/call-end    [:i {:data-lucide "check" :class "size-3 text-[var(--good)]"}]
    :session.event.type/call-error  [:i {:data-lucide "x-circle" :class "size-3 text-[var(--danger)]"}]
    :session.event.type/thinking    [:i {:data-lucide "brain" :class "size-3 text-[var(--purple)]"}]
    :session.event.type/state-change [:i {:data-lucide "arrow-right" :class "size-3 text-[var(--warn)]"}]
    [:i {:data-lucide "circle" :class "size-3 text-[#9e9daa]"}]))

(defn- event-card [event]
  (let [event-type (:session.event/type event)
        payload (:session.event/payload event)
        tool-key (:tool-key payload)
        input (:input payload)
        output (:output payload)
        reasoning (:reasoning payload)
        error (:error payload)]
    [:div {:class (str "rounded-lg px-3 py-2 text-[12px] "
                    (case event-type
                      :session.event.type/call-error "bg-[#2a1a1a] border border-[#4a2020]"
                      :session.event.type/thinking "bg-[#1f1a2e] border border-[#33294a]"
                      :session.event.type/state-change "bg-[#1a1f2a] border border-[#293344]"
                      "bg-[#242429] border border-[#33333a]"))}
     [:div {:class "flex items-center gap-2 mb-1"}
      (event-type-icon event-type)
      [:span {:class "font-medium text-[#e8e6e3]"} (:session.event/message event)]
      (when tool-key
        [:span {:class "text-[10px] px-1.5 py-0.5 rounded bg-[#33333a] text-[#9e9daa] font-mono"} tool-key])]
     (when input
       [:div {:class "mt-1.5"}
        [:div {:class "text-[10px] uppercase tracking-wider text-[#6b6a77] mb-0.5"} "Input"]
        [:pre {:class "text-[11px] text-[#b7b6c2] font-mono whitespace-pre-wrap overflow-x-auto max-h-24 overflow-y-auto"} input]])
     (when output
       [:div {:class "mt-1.5"}
        [:div {:class "text-[10px] uppercase tracking-wider text-[#6b6a77] mb-0.5"} "Output"]
        [:pre {:class "text-[11px] text-[#b7b6c2] font-mono whitespace-pre-wrap overflow-x-auto max-h-32 overflow-y-auto"} output]])
     (when reasoning
       [:div {:class "mt-1.5"}
        [:div {:class "text-[10px] uppercase tracking-wider text-[var(--purple)] mb-0.5"} "Reasoning"]
        [:pre {:class "text-[11px] text-[#c4b5de] font-mono whitespace-pre-wrap overflow-x-auto max-h-48 overflow-y-auto"} reasoning]])
     (when error
       [:div {:class "mt-1.5"}
        [:div {:class "text-[10px] uppercase tracking-wider text-[var(--danger)] mb-0.5"} "Error"]
        [:pre {:class "text-[11px] text-[#e8a0a0] font-mono whitespace-pre-wrap"} error]])]))

(defn- sanitize-binary [s]
  (if (and s (or (re-find #"(?m)^[A-Za-z0-9+/\n]{100,}={0,2}$" (str s))
               (re-find #"echo\s+'[A-Za-z0-9+/]{40,}" (str s))
               (str/includes? (str s) "| base64 -d")))
    "[binary content hidden]"
    s))

(defn- render-markdown
  "Convert markdown string to hiccup using nextjournal/markdown."
  [content]
  (when (and content (not (str/blank? (str content))))
    (md/->hiccup (str content))))

(defn- unescape-edn-str
  "Unescape \\n and \\t from EDN-encoded strings."
  [s]
  (when s (-> s (str/replace "\\n" "\n") (str/replace "\\t" "\t"))))

(defn- render-reasoning [reasoning]
  [:div {:class "rounded-lg px-3 py-2 border-l-4"
         :style "background: var(--purple-soft); border-color: var(--purple);"}
   [:div {:class "text-[11px] font-prose leading-relaxed max-h-48 overflow-auto"
          :style "color: var(--ink-secondary);"}
    (render-markdown reasoning)]])

(defn- render-tool-call
  "Render a single tool call with smart output for read-file/grep/glob."
  [evt tool-ends]
  (let [payload (:session.event/payload evt)
        tk (or (:tool-key payload) "?")
        short-name (last (str/split tk #"\."))
        input (sanitize-binary (:input payload))
        end-evt (get tool-ends tk)
        pe (when end-evt (:session.event/payload end-evt))
        output (sanitize-binary (:output pe))
        error (:error pe)
        ok? (= :session.event.type/call-end (:session.event/type end-evt))
        read? (str/includes? tk "read-file")
        grep? (str/includes? tk "grep")
        glob? (str/includes? tk "glob")
        file-content (when (and read? output (not error))
                       (second (re-find #":content\s+\"((?:[^\"\\]|\\.)*)\"" output)))
        file-path (when input (second (re-find #":path\s+\"([^\"]+)\"" input)))
        grep-matches (when (and grep? output (not error))
                       (second (re-find #":matches\s+\[([^\]]*)\]" output)))
        glob-file-list (when (and glob? output (not error))
                         (re-seq #"\"([^\"]+)\"" (or (second (re-find #":files\s+\[([^\]]*)\]" output)) "")))
        glob-count (when (and glob? output (not error))
                     (second (re-find #":count\s+(\d+)" output)))
        input-hint (when input (let [s (str/replace input #"[{}:\"]" "")]
                                 (if (> (count s) 50) (str (subs s 0 50) "…") s)))]
    [:details {:class "rounded-lg text-[12px]"}
     [:summary {:class "flex items-center gap-1.5 px-2 py-1 cursor-pointer select-none hover:bg-[var(--cream-dark)] rounded-lg"}
      (cond ok?   [:i {:data-lucide "check" :class "size-3 text-[var(--good)] flex-shrink-0"}]
            error [:i {:data-lucide "x-circle" :class "size-3 text-[var(--danger)] flex-shrink-0"}]
            :else [:i {:data-lucide "loader" :class "size-3 text-[var(--warn)] flex-shrink-0 animate-spin"}])
      [:span {:class "text-[var(--ink)] font-medium text-[11px] w-[80px] flex-shrink-0"} short-name]
      [:span {:class "text-[10px] text-[var(--muted)] truncate flex-1"} (or file-path input-hint "")]
      (when error [:span {:class "text-[10px] text-[var(--danger)]"} "error"])]
     (when (or input output error)
       [:div {:class "pl-[26px] pr-2 pb-2 space-y-1 border-l-2 border-[var(--line)] ml-[9px]"}
        (cond
          error [:pre {:class "text-[10px] text-[var(--danger)] font-mono whitespace-pre-wrap max-h-16 overflow-auto break-words"} error]
          (and read? file-content)
          [:div {:class "rounded-lg overflow-hidden border border-[var(--line)]"}
           (when file-path [:div {:class "text-[9px] px-2 py-1 bg-[var(--cream-dark)] text-[var(--muted)] border-b border-[var(--line)] font-mono"} file-path])
           [:pre {:class "text-[10px] font-mono px-2 py-1.5 whitespace-pre-wrap max-h-48 overflow-auto break-words" :style "color: var(--ink);"} (unescape-edn-str file-content)]]
          (and grep? grep-matches)
          [:pre {:class "text-[10px] font-mono px-2 py-1.5 whitespace-pre-wrap max-h-32 overflow-auto break-words" :style "color: var(--ink);"}
           (-> grep-matches (str/replace "\\\"" "\"") (str/replace "\" \"" "\n") (str/replace "\"" ""))]
          (and glob? glob-file-list)
          [:div {:class "rounded-lg overflow-hidden border border-[var(--line)]"}
           [:div {:class "text-[9px] px-2 py-1 bg-[var(--cream-dark)] text-[var(--muted)] border-b border-[var(--line)] font-mono"} (str glob-count " files")]
           [:pre {:class "text-[10px] font-mono px-2 py-1.5 whitespace-pre-wrap max-h-32 overflow-auto" :style "color: var(--ink);"}
            (str/join "\n" (map second (take 20 glob-file-list)))
            (when (> (count glob-file-list) 20) (str "\n… and " (- (count glob-file-list) 20) " more"))]]
          :else
          [:div {:class "space-y-1"}
           (when input [:pre {:class "text-[10px] text-[var(--ink-secondary)] font-mono whitespace-pre-wrap max-h-24 overflow-auto break-words"} input])
           (when output [:pre {:class "text-[10px] text-[var(--muted)] font-mono whitespace-pre-wrap max-h-24 overflow-auto break-words"} output])])])]))

(defn- render-iteration-block
  "Render an iteration group with border wrapping reasoning + tool calls."
  [iter-num reasoning tool-calls tool-ends & [{:keys [final? execs]}]]
  [:details {:class "rounded-xl border border-[var(--line)] text-[12px] my-1" :open true}
   [:summary {:class "flex items-center gap-2 px-3 py-2 cursor-pointer select-none hover:bg-[var(--cream-dark)] rounded-xl font-medium"}
    [:span {:class "text-[var(--accent)] text-[11px] font-bold w-6"} (str iter-num)]
    (cond
      final? [:span {:class "text-[var(--good)] text-[11px]"} "Final answer"]
      execs  [:span {:class "text-[var(--ink-secondary)] text-[11px]"} (str (count execs) " code blocks")]
      :else  [:span {:class "text-[var(--ink-secondary)] text-[11px]"} (str (count tool-calls) " tool calls")])]
   [:div {:class "px-3 pb-3 space-y-2"}
    (when reasoning (render-reasoning reasoning))
    ;; New-style code executions
    (when (seq execs)
      (into [:div {:class "space-y-1"}]
        (map (fn [{:keys [code result error]}]
               [:div {:class "rounded-lg bg-[var(--cream-dark)] overflow-hidden"}
                [:pre {:class "text-[10px] font-mono px-2 py-1.5 text-[var(--ink)] whitespace-pre-wrap max-h-20 overflow-auto"} code]
                (when (or result error)
                  [:div {:class (str "text-[10px] font-mono px-2 py-1 border-t border-[var(--line)] whitespace-pre-wrap max-h-16 overflow-auto "
                                     (if error "text-[var(--danger)]" "text-[var(--muted)]"))}
                   (or error result)])])
             execs)))
    ;; Legacy tool calls
    (when (seq tool-calls)
      (into [:div {:class "space-y-0.5"}]
        (map #(render-tool-call % tool-ends) tool-calls)))]])

(defn- group-legacy-events
  "Group flat thinking + call-start events into iteration blocks."
  [events]
  (reduce
   (fn [acc evt]
     (case (:session.event/type evt)
       :session.event.type/thinking
       (conj acc {:type :iteration :reasoning (:reasoning (:session.event/payload evt)) :tool-calls [] :others []})

       :session.event.type/call-start
       (if (seq acc)
         (update-in acc [(dec (count acc)) :tool-calls] conj evt)
         (conj acc {:type :iteration :reasoning nil :tool-calls [evt] :others []}))

       (:session.event.type/call-end :session.event.type/call-error) acc

       :session.event.type/state-change
       (if (seq acc)
         (update-in acc [(dec (count acc)) :others] conj evt)
         (conj acc {:type :state :evt evt}))

       (if (seq acc)
         (update-in acc [(dec (count acc)) :others] conj evt)
         (conj acc {:type :state :evt evt}))))
   [] events))

(defn- run-card [run {:keys [task-id org-id]}]
  (let [events (:session/events run)
        msgs (filter #(= :session.messages.role/assistant (:session.messages/role %))
               (:session/messages run))
        tool-ends (into {} (keep (fn [e]
                                   (when (#{:session.event.type/call-end :session.event.type/call-error}
                                          (:session.event/type e))
                                     [(:tool-key (:session.event/payload e)) e]))
                                 events))
        failed? (= :session.status/failed (:session/status run))
        has-iterations? (some #(= :session.event.type/iteration (:session.event/type %)) events)
        grouped (when-not has-iterations? (group-legacy-events events))]
    [:div {:class "card overflow-hidden"}
     [:div {:class "flex items-center justify-between px-4 py-3 bg-[var(--cream-dark)] border-b border-[var(--line)]"}
      (ui/status-badge (:run/status run))
      (when failed?
        [:form {:method "post" :action (str "/organizations/" org-id "/tasks/" task-id "/runs")}
         [:button {:class "text-[12px] font-medium text-[var(--accent)] hover:text-[var(--ink)] flex items-center gap-1.5 cursor-pointer" :type "submit"}
          [:i {:data-lucide "rotate-ccw" :class "size-3"}]
          "Retry"]])]
     [:div {:class "p-4"}
      (if has-iterations?
        ;; New-style: iteration events from on-iteration callback
        (into [:div {:class "space-y-1"}]
          (keep
           (fn [evt]
             (let [etype (:session.event/type evt)
                   payload (:session.event/payload evt)]
               (case etype
                 :session.event.type/iteration
                 (render-iteration-block
                  (inc (or (:iteration payload) 0))
                  (:reasoning payload) nil tool-ends
                  {:final? (:final? payload) :execs (:executions payload)})
                 :session.event.type/state-change
                 [:div {:class "flex items-center gap-1.5 px-2 py-0.5 text-[11px] text-[var(--muted)]"}
                  [:i {:data-lucide "arrow-right" :class "size-3"}]
                  (:session.event/message evt)]
                 :session.event.type/ac-verification
                 [:div {:class "flex items-center gap-1.5 px-2 py-1 text-[11px] rounded-lg"
                        :style "background: var(--good-soft);"}
                  [:i {:data-lucide "check-circle" :class "size-3 text-[var(--good)]"}]
                  [:span {:style "color: var(--ink);"} (:session.event/message evt)]]
                 (:session.event.type/call-end :session.event.type/call-error :session.event.type/thinking) nil
                 nil)))
           events))

        ;; Legacy: grouped thinking + tool calls into iteration blocks
        (into [:div {:class "space-y-1"}]
          (keep-indexed
           (fn [idx item]
             (case (:type item)
               :iteration
               (render-iteration-block (inc idx) (:reasoning item) (:tool-calls item) tool-ends)
               :state
               [:div {:class "flex items-center gap-1.5 px-2 py-0.5 text-[11px] text-[var(--muted)]"}
                [:i {:data-lucide "arrow-right" :class "size-3"}]
                (:session.event/message (:evt item))]
               nil))
           grouped)))

      ;; Final assistant message
      (when-let [msg (last (seq msgs))]
        [:div {:class "mt-3 card p-4 border-l-4 border-[var(--accent)]"}
         [:div {:class "text-[11px] uppercase tracking-[0.08em] text-[var(--accent)] mb-2 flex items-center gap-1.5"}
          [:i {:data-lucide "message-square" :class "size-3.5"}]
          "Result"]
         [:div {:class "text-[13px] text-[var(--ink)] leading-relaxed prose prose-sm max-w-none"}
          (render-markdown (:session.messages/content msg))]])]]))

(defn render-runs-fragment
  "Render just the run history section as HTML for SSE patching.

   Params:
   `conn` - Datalevin connection.
   `task-id` - UUID. Task identifier.

   Returns:
   Hiccup for the #run-history div, or nil if task not found."
  [conn task-id]
  (when-let [task (db.task/find-task conn task-id)]
    (let [org-id (get-in task [:task/ticket :ticket/organization :organization/id])
          runs (mapv (fn [run]
                       (assoc run :run/status (:session/runtime-status run)
                         :run/logs (:session/logs run)
                         :run/exit-code (:session/exit-code run)
                         :session/events (session/list-session-events conn (:session/id run))
                         :session/messages (session/list-session-messages conn (:session/id run))))
                 (session/list-by-task conn task-id))
          any-running? (some #(= :session.runtime/running (:run/status %)) runs)]
      {:html [:div {:id "run-history"
                    :data-on-load (when any-running?
                                    (d*/sse-get (str "/fragments/tasks/" task-id "/runs")))}
              (ui/section-heading {:title (i18n/t :task/run-history) :count (count runs)})
              (if (seq runs)
                (into [:div {:class "mt-4 space-y-3"}]
                  (map #(run-card % {:task-id task-id :org-id org-id}) runs))
                (ui/empty-state (i18n/t :task/no-runs) "mt-4"))]
       :any-running? any-running?})))

(defn render
  "Render a task detail screen.

   Params:
   `conn` - Datalevin connection.
   `task-id` - UUID. Task identifier.

   Returns:
   HTML page string."
  [conn task-id]
  (if-let [task (db.task/find-task conn task-id)]
    (let [runs (mapv (fn [run]
                       (assoc run :run/status (:session/runtime-status run)
                         :run/logs (:session/logs run)
                         :run/exit-code (:session/exit-code run)
                         :session/events (session/list-session-events conn (:session/id run))))
                 (session/list-by-task conn task-id))
          available (get next-statuses (:task/status task) [])
          ticket-desc (or (get-in task [:task/ticket :ticket/title])
                        (get-in task [:task/ticket :ticket/description]))
          ticket-id (get-in task [:task/ticket :ticket/id])
          ws-name (get-in task [:task/workspace :workspace/name])
          ws-id (get-in task [:task/workspace :workspace/id])
          org-name (get-in task [:task/ticket :ticket/organization :organization/name])
          org-id (get-in task [:task/ticket :ticket/organization :organization/id])
          org (db.organization/find-organization conn org-id)
          organizations (organization/list-organizations conn)
          body
          [:div {:class "grid gap-6 lg:grid-cols-[1fr_300px]"}
           [:div {:class "space-y-5"}
            [:div
             [:div {:class "flex items-center gap-2 mb-3"}
              (ui/status-badge (:task/status task))]
             [:h1 {:class "text-[24px] leading-tight"}
              (:task/description task)]]
            (let [ac-entities (->> (d/q '[:find [(pull ?e [:task.ac/id :task.ac/index :task.ac/text
                                                           :task.ac/verdict :task.ac/reasoning]) ...]
                                        :in $ ?tid
                                        :where [?t :task/id ?tid] [?e :task.ac/task ?t]]
                                      (d/db conn) task-id)
                                (sort-by :task.ac/index))
                  ;; Fallback to EDN if no entities yet
                  criteria (if (seq ac-entities)
                             ac-entities
                             (when-let [edn-str (:task/acceptance-criteria-edn task)]
                               (map-indexed (fn [i c] {:task.ac/index i
                                                       :task.ac/text (if (map? c) (:text c) (str c))
                                                       :task.ac/verdict :ac.status/pending})
                                 (try (edn/read-string edn-str) (catch Exception _ [])))))]
              (when (seq criteria)
                [:div {:class "card p-5"}
                 [:div {:class "field-label mb-3"} (i18n/t :ticket/acceptance-criteria)]
                 (into [:ul {:class "space-y-2.5 list-none p-0 m-0"}]
                   (map (fn [ac]
                          (let [v (:task.ac/verdict ac)
                                verified? (= :ac.status/verified v)
                                failed? (= :ac.status/failed v)]
                            [:li {:class "flex items-start gap-2.5"}
                             (cond
                               verified? [:i {:data-lucide "check-circle" :class "size-4 mt-0.5 flex-shrink-0 text-[var(--good)]"}]
                               failed?   [:i {:data-lucide "x-circle" :class "size-4 mt-0.5 flex-shrink-0 text-[var(--danger)]"}]
                               :else     [:i {:data-lucide "circle-dashed" :class "size-4 mt-0.5 flex-shrink-0 text-[var(--muted)]"}])
                             [:div
                              [:span {:class (str "text-[14px] leading-relaxed "
                                               (cond verified? "text-[var(--ink)] line-through opacity-60"
                                                 failed?   "text-[var(--danger)]"
                                                 :else     "text-[var(--ink-secondary)]"))}
                               (:task.ac/text ac)]
                              (when-let [r (:task.ac/reasoning ac)]
                                [:div {:class "text-[12px] text-[var(--muted)] mt-0.5 italic"} r])]]))
                     criteria))]))
            (let [deliverables (when-let [edn-str (:task/deliverables-edn task)]
                                 (try (edn/read-string edn-str) (catch Exception _ nil)))]
              (when (seq deliverables)
                [:div
                 (ui/section-heading {:title (i18n/t :task/deliverables) :count (count deliverables)})
                 [:div {:class "mt-3 space-y-2"}
                  (for [{:keys [title description status]} deliverables]
                    [:div {:class "card p-4 flex items-start gap-3"}
                     [:div {:class "mt-0.5"}
                      (if (= status "done")
                        [:i {:data-lucide "check-circle" :class "w-4 h-4 text-[var(--good)]"}]
                        [:i {:data-lucide "circle" :class "w-4 h-4 text-[var(--muted)]"}])]
                     [:div
                      [:div {:class "text-[14px] font-medium"} title]
                      (when (and description (not (str/blank? description)))
                        [:div {:class "text-[13px] text-[var(--ink-secondary)] mt-0.5"} description])]])]]))
            (let [ws-id (get-in task [:task/workspace :workspace/id])
                  git-commits (when ws-id
                                (when-let [repo (db.git/find-repo-by-workspace conn ws-id)]
                                  (->> (db.git/list-commits-by-repo conn (:git.repo/id repo))
                                    (map (fn [c]
                                           {:sha (:git.commit/sha c)
                                            :message (:git.commit/message c)
                                            :author (some-> c :git.commit/author :git.author/name)
                                            :date (some-> c :git.commit/authored-at str)}))
                                    vec)))]
              (git-progress/commits-section git-commits {:title "Git Activity"}))
            [:div {:id "run-history"
                   :data-on-load (d*/sse-get (str "/fragments/tasks/" task-id "/runs"))}
             (ui/section-heading {:title (i18n/t :task/run-history) :count (count runs)})
             (if (seq runs)
               (into [:div {:class "mt-4 space-y-3"}]
                 (map #(run-card % {:task-id task-id :org-id org-id}) runs))
               (ui/empty-state (i18n/t :task/no-runs) "mt-4"))]]
           [:aside {:class "space-y-4"}
            [:div {:class "card p-5"}
             [:div {:class "field-label mb-3"} (i18n/t :details/title)]
             (detail-row (i18n/t :details/status) (ui/status-badge (:task/status task)))
             (detail-row (i18n/t :details/runs) [:span {:class "text-[14px] font-bold"} (count runs)])
             (detail-row (i18n/t :details/ticket)
               [:a {:href (str "/organizations/" org-id "/tickets/" ticket-id)} ticket-desc])
             (detail-row (i18n/t :details/workspace)
               [:a {:href (str "/organizations/" org-id "/workspaces/" ws-id)} ws-name])
             (detail-row (i18n/t :details/organization)
               [:a {:href (str "/organizations/" org-id)} org-name])]]]]
      (layout/page "Task" body
        {:breadcrumbs [{:href "/" :label "Organizations"}
                       {:href (str "/organizations/" org-id) :label org-name}
                       {:href (str "/organizations/" org-id "/tickets/" ticket-id) :label ticket-desc}
                       {:label (let [d (:task/description task)]
                                 (if (> (count d) 50) (str (subs d 0 50) "…") d))}]
         :topbar-context (layout/render-fragment (ui/org-topbar-dropdown organizations org))}))
    (layout/page "Not found" [:p "Task not found."])))
