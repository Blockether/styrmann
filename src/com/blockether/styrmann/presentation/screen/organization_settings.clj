(ns com.blockether.styrmann.presentation.screen.organization-settings
  "SSR organization settings screen — provider and runner configuration."
  (:require
   [com.blockether.styrmann.domain.organization :as organization]
   [com.blockether.styrmann.domain.provider :as provider]
   [com.blockether.styrmann.execution.session :as session]
   [com.blockether.styrmann.i18n :as i18n]
   [com.blockether.styrmann.presentation.component.layout :as layout]
   [com.blockether.styrmann.presentation.component.ui :as ui]))

;; -- Form helpers -------------------------------------------------------------

(defn- text-field [label input-name value placeholder & [{:keys [type required?]
                                                          :or {type "text" required? true}}]]
  [:label {:class "block"}
   [:span {:class "text-[12px] font-medium text-[var(--muted)] uppercase tracking-wider mb-1 block"} label]
   [:input {:class "input"
            :type type
            :name input-name
            :value (or value "")
            :placeholder placeholder
            :required required?}]])

(defn- select-field [label input-name options selected]
  [:label {:class "block"}
   [:span {:class "text-[12px] font-medium text-[var(--muted)] uppercase tracking-wider mb-1 block"} label]
   (into [:select {:class "input" :name input-name}]
         (for [[value label-text] options]
           [:option (cond-> {:value value}
                      (= value selected) (assoc :selected true))
            label-text]))])

(defn- toggle-field [label input-name checked?]
  [:label {:class "flex items-center gap-3 cursor-pointer group py-1"}
   [:div {:class (str "relative w-9 h-5 rounded-full transition-colors "
                      (if checked? "bg-[var(--accent)]" "bg-[var(--line-strong)]"))}
    [:input {:type "checkbox" :name input-name :value "true"
             :checked checked?
             :class "sr-only peer"}]
    [:div {:class (str "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform "
                       (if checked? "left-[18px]" "left-0.5"))}]]
   [:span {:class "text-[13px] text-[var(--ink-secondary)] group-hover:text-[var(--ink)]"} label]])

;; -- Provider tab -------------------------------------------------------------

(defn- provider-row [provider]
  [:div {:class "flex items-center justify-between py-3 border-b border-[var(--line)] last:border-0"}
   [:div
    [:div {:class "text-[14px] font-medium"} (:provider/name provider)]
    [:div {:class "text-[12px] text-[var(--muted)] font-mono mt-0.5"} (:provider/base-url provider)]]
   (when (:provider/default? provider)
     [:span {:class "badge badge-green text-[10px]"} "default"])])

(defn- llm-providers-card [organization-id providers]
  [:div {:class "space-y-6"}
   ;; Existing providers
   [:div
    [:div {:class "flex items-center justify-between mb-3"}
     [:h2 {:class "text-[16px] font-medium"} (i18n/t :settings/llm-providers)]
     [:span {:class "text-[12px] text-[var(--muted)]"}
      (str (count providers) " provider" (when-not (= 1 (count providers)) "s"))]]
    [:p {:class "text-[13px] text-[var(--muted)] mb-4"}
     (i18n/t :settings/provider-description)]
    (if (seq providers)
      (into [:div {:class "card p-4"}]
            (map provider-row providers))
      [:div {:class "card p-6 text-center text-[var(--muted)] text-[13px] italic"}
       (i18n/t :settings/no-providers)])]

   ;; Add provider form
   [:div {:class "card p-5"}
    [:h3 {:class "text-[14px] font-medium mb-4"} (i18n/t :settings/add-provider)]
    [:form {:class "space-y-4" :method "post" :action (str "/organizations/" organization-id "/settings/provider")}
     (text-field "Provider name" "name" "" "OpenAI")
     (text-field "Base URL" "base-url" "" "https://api.openai.com/v1")
     (text-field "API Key" "api-key" "" "sk-..." {:type "password"})
     [:div {:class "flex items-center justify-between pt-2"}
      (toggle-field "Set as default provider" "default?" false)
      [:button {:class "btn-primary" :type "submit"}
       [:i {:data-lucide "plus" :class "size-4"}]
       "Add provider"]]]]])

;; -- Runner tab ---------------------------------------------------------------

(defn- runner-settings-card [organization-id org environments providers]
  (let [workspaces (:organization/workspaces org)
        provider-options (into [["" "Use default provider"]]
                               (mapv (fn [p] [(str (:provider/id p)) (:provider/name p)]) providers))]
    [:div {:class "space-y-6"}
     ;; Default runner config
     [:div {:class "card p-5"}
      [:h2 {:class "text-[16px] font-medium mb-1"} "Default Runner"]
      [:p {:class "text-[13px] text-[var(--muted)] mb-4"}
       "Default model and provider for all workspaces. Workspace-specific overrides below."]
      [:form {:class "space-y-4" :method "post" :action (str "/organizations/" organization-id "/settings/runner")}
       [:input {:type "hidden" :name "workspace-id" :value ""}]
       [:div {:class "grid grid-cols-2 gap-4"}
        (select-field "Provider" "provider-id" provider-options "")
        (text-field "Default model" "model" "glm-5-turbo" "glm-5-turbo")]
       [:div {:class "grid grid-cols-3 gap-3"}
        (text-field "Fallback model 1" "fallback-1" "" "gpt-4o" {:required? false})
        (text-field "Fallback model 2" "fallback-2" "" "gpt-4o-mini" {:required? false})
        (text-field "Fallback model 3" "fallback-3" "" "claude-sonnet-4-6" {:required? false})]
       [:div {:class "flex justify-end pt-2"}
        [:button {:class "btn-primary" :type "submit"}
         [:i {:data-lucide "save" :class "size-4"}]
         "Save defaults"]]]]

     ;; Workspace runners
     [:div
      [:h2 {:class "text-[16px] font-medium mb-1"} "Workspace Runners"]
      [:p {:class "text-[13px] text-[var(--muted)] mb-4"}
       "Override the default runner for specific workspaces."]
      (if (seq workspaces)
        (into [:div {:class "space-y-3"}]
              (for [ws workspaces]
                (let [env (some #(when (= (get-in % [:execution-environment/workspace :workspace/id])
                                          (:workspace/id ws))
                                   %)
                                environments)]
                  [:details {:class "card overflow-hidden"}
                   [:summary {:class "flex items-center justify-between px-5 py-3 cursor-pointer select-none hover:bg-[var(--cream-dark)]"}
                    [:div {:class "flex items-center gap-2"}
                     [:i {:data-lucide "folder" :class "size-4 text-[var(--muted)]"}]
                     [:span {:class "text-[14px] font-medium"} (:workspace/name ws)]]
                    (if env
                      [:span {:class "text-[11px] text-[var(--muted)]"} (:execution-environment/model env)]
                      [:span {:class "text-[11px] text-[var(--muted)] italic"} "using defaults"])]
                   [:div {:class "px-5 pb-4 pt-2 border-t border-[var(--line)]"}
                    [:form {:class "space-y-4" :method "post" :action (str "/organizations/" organization-id "/settings/runner")}
                     [:input {:type "hidden" :name "workspace-id" :value (str (:workspace/id ws))}]
                     [:div {:class "grid grid-cols-2 gap-4"}
                      (select-field "Provider override" "provider-id" provider-options
                                    (str (get-in env [:execution-environment/provider :provider/id])))
                      (text-field "Model override" "model"
                                  (:execution-environment/model env)
                                  "Leave empty for default" {:required? false})]
                     [:div {:class "flex justify-end pt-1"}
                      [:button {:class "btn-primary text-[13px]" :type "submit"}
                       "Save override"]]]]])))
        [:div {:class "card p-6 text-center text-[var(--muted)] text-[13px] italic"}
         "No workspaces registered yet."])]]))

;; -- Tabs + layout ------------------------------------------------------------

(defn- tab-link [href label active?]
  [:a {:class (str "px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors "
                   (if active?
                     "border-[var(--accent)] text-[var(--accent)]"
                     "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"))
       :href href}
   label])

(defn render
  "Render an organization settings screen.

   Params:
   `conn` - Datalevin connection.
   `organization-id` - UUID. Organization identifier.
   `active-tab` - keyword. Either :providers or :runner.

   Returns:
   HTML page string."
  [conn organization-id & [active-tab]]
  (let [active-tab (or active-tab :providers)]
    (if-let [org (organization/overview conn organization-id)]
      (let [organizations (organization/list-organizations conn)
            environments (session/list-environments-by-organization conn organization-id)
            providers (provider/list-providers conn)]
        (layout/page
         "Organization settings"
         [:div {:class "max-w-3xl space-y-6"}
          [:div
           [:h1 {:class "text-[28px] leading-tight"} (i18n/t :settings/title)]
           [:p {:class "mt-2 text-[14px] text-[var(--muted)]"}
            (i18n/t :settings/manage-description)]]
          ;; Tabs
          [:div {:class "flex border-b border-[var(--line)] mb-1"}
           (tab-link (str "/organizations/" organization-id "/settings?tab=providers")
                     (i18n/t :settings/llm-providers)
                     (= active-tab :providers))
           (tab-link (str "/organizations/" organization-id "/settings?tab=runner")
                     "Runner Configuration"
                     (= active-tab :runner))]
          ;; Tab content
          (case active-tab
            :providers (llm-providers-card organization-id providers)
            :runner (runner-settings-card organization-id org environments providers))
          ;; Org info
          [:div {:class "card p-5"}
           [:div {:class "text-[12px] font-medium text-[var(--muted)] uppercase tracking-wider mb-2"}
            (i18n/t :settings/current-organization)]
           [:div {:class "text-[20px]" :style "font-family: 'DM Serif Display', Georgia, serif"}
            (:organization/name org)]
           [:p {:class "mt-2 text-[13px] text-[var(--muted)]"}
            (if (:organization/default? org)
              (i18n/t :settings/is-default-org)
              (i18n/t :settings/not-default-org))]]]
         {:breadcrumbs [{:href "/" :label "Organizations"}
                        {:href (str "/organizations/" organization-id) :label (:organization/name org)}
                        {:label (i18n/t :settings/title)}]
          :topbar-context (layout/render-fragment (ui/org-topbar-dropdown organizations org))}))
      (layout/page "Not found" [:p "Organization not found."]))))
