(ns com.blockether.styrmann.presentation.screen.organization-settings
  "SSR organization settings screen."
  (:require
   [com.blockether.styrmann.domain.organization :as organization]
   [com.blockether.styrmann.domain.provider :as provider]
   [com.blockether.styrmann.execution.session :as session]
   [com.blockether.styrmann.presentation.component.layout :as layout]
   [com.blockether.styrmann.presentation.component.ui :as ui]))

(defn- text-field [label input-name value placeholder]
  [:label {:class "block"}
   [:span {:class "field-label"} label]
   [:input {:class "input"
            :type "text"
            :name input-name
            :value (or value "")
            :placeholder placeholder
            :required true}]])

(defn- optional-text-field [label input-name value placeholder]
  [:label {:class "block"}
   [:span {:class "field-label"} label]
   [:input {:class "input"
            :type "text"
            :name input-name
            :value (or value "")
            :placeholder placeholder}]])

(defn- select-field [label input-name options selected]
  [:label {:class "block"}
   [:span {:class "field-label"} label]
   (into [:select {:class "input" :name input-name}]
         (for [[value label-text] options]
           [:option (cond-> {:value value}
                      (= value selected) (assoc :selected true))
            label-text]))])

(defn- provider-row [provider]
  [:tr {:class "border-b border-[var(--border)]"}
   [:td {:class "py-3 pr-4 font-medium"} (:provider/name provider)]
   [:td {:class "py-3 pr-4 text-[var(--muted)]"} (:provider/base-url provider)]
   [:td {:class "py-3 pr-4"}
    (if (:provider/default? provider)
      [:span {:class "badge badge-green"} "default"]
      [:span {:class "text-[12px] text-[var(--muted)]"} "set as default"])]])

(defn- llm-providers-card [organization-id providers]
  [:div {:class "card p-6"}
   [:div {:class "flex items-center justify-between mb-4"}
    [:h2 {:class "text-[16px] font-medium"} "LLM Providers"]
    [:span {:class "text-[13px] text-[var(--muted)]"}
     (str (count providers) " provider" (when-not (= 1 (count providers)) "s"))]]
   [:p {:class "mb-4 text-[13px] text-[var(--muted)]"}
    "Configure LLM provider credentials for Svar. Each provider defines an API endpoint and key."]
   (if (seq providers)
     [:table {:class "w-full text-[13px]"}
      [:thead]
      [:tbody
       (for [p providers]
         (provider-row p))]]
     [:p {:class "text-[13px] text-[var(--muted)] italic mb-4"} "No providers configured."])
   [:form {:class "mt-6 pt-6 border-t border-[var(--border)] space-y-4" :method "post" :action (str "/organizations/" organization-id "/settings/provider")}
    [:h3 {:class "text-[14px] font-medium mb-3"} "Add provider"]
    (text-field "Name" "name" "" "OpenAI")
    (text-field "Base URL" "base-url" "" "https://api.openai.com/v1")
    (text-field "API Key" "api-key" "" "sk-...")
    [:div {:class "flex items-center gap-3 pt-1"}
     [:label {:class "flex items-center gap-2 text-[13px] cursor-pointer"}
      [:input {:type "checkbox" :name "default?" :value "true"}]
      "Set as default provider"]
     [:div {:class "flex-1"}]
     [:button {:class "btn-primary" :type "submit"} "Add provider"]]]])

(defn- runner-settings-card [organization-id org environments providers]
  (let [workspaces (:organization/workspaces org)
        current-workspace (first workspaces)
        current-env (some #(when (= (get-in % [:execution-environment/workspace :workspace/id])
                                    (:workspace/id current-workspace))
                             %)
                          environments)
        provider-options (mapv (fn [p] [(str (:provider/id p)) (:provider/name p)]) providers)
        provider-options (if (seq provider-options)
                           provider-options
                           [["" "No providers available"]])]
    [:div {:class "card p-6"}
     [:h2 {:class "text-[16px] font-medium mb-3"} "Runner settings"]
     [:p {:class "mb-4 text-[13px] text-[var(--muted)]"}
      "Configure the execution environment for agent sessions. Each workspace can use a different LLM provider."]
     (if (seq workspaces)
       [:form {:class "space-y-4" :method "post" :action (str "/organizations/" organization-id "/settings/runner")}
        (select-field
         "Workspace"
         "workspace-id"
         (mapv (fn [w] [(str (:workspace/id w)) (:workspace/name w)]) workspaces)
         (str (:workspace/id current-workspace)))
        (select-field
         "Provider"
         "provider-id"
         provider-options
         (str (get-in current-env [:execution-environment/provider :provider/id])))
        (text-field
         "Model"
         "model"
         (:execution-environment/model current-env)
         "gpt-4o-mini")
        (optional-text-field
         "Working directory"
         "working-directory"
         (:execution-environment/working-directory current-env)
         "/opt/styrmann")
        (select-field
         "Status"
         "status"
         [["execution-environment.status/ready" "Ready"]
          ["execution-environment.status/busy" "Busy"]
          ["execution-environment.status/offline" "Offline"]
          ["execution-environment.status/error" "Error"]]
         (str (or (:execution-environment/status current-env)
                  :execution-environment.status/ready)))
        [:div {:class "flex justify-end"}
         [:button {:class "btn-primary" :type "submit"} "Save runner settings"]]]
       (ui/empty-state "Create a workspace first."))]))

(defn- tab-link [href label active?]
  [:a {:class (str "px-4 py-2 text-[14px] font-medium border-b-2 transition-colors "
                   (if active?
                     "border-[var(--accent)] text-[var(--accent)]"
                     "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"))
       :href href}
   label])

(defn render
  "Render an organization settings screen.

   Params:
   `conn` - Datalevin connection.
   `organization-id` - UUID. Organization identifier.
   `active-tab` - keyword. Either :providers or :runner. Defaults to :providers.

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
           [:h1 {:class "text-[28px] leading-tight"} "Settings"]
           [:p {:class "mt-2 text-[14px] text-[var(--muted)]"}
            "Manage LLM providers and execution settings for this organization."]]
          [:div {:class "card p-0 overflow-hidden"}
           [:div {:class "flex border-b border-[var(--border)]"}
            (tab-link (str "/organizations/" organization-id "/settings?tab=providers")
                      "LLM Providers"
                      (= active-tab :providers))
            (tab-link (str "/organizations/" organization-id "/settings?tab=runner")
                      "Runner Settings"
                      (= active-tab :runner))]
           [:div {:class "p-6"}
            (case active-tab
              :providers (llm-providers-card organization-id providers)
              :runner (runner-settings-card organization-id org environments providers))]]
          [:div {:class "card p-6"}
           [:div {:class "field-label mb-3"} "Current organization"]
           [:div {:class "text-[20px]" :style "font-family: 'DM Serif Display', Georgia, serif"}
            (:organization/name org)]
           [:p {:class "mt-2 text-[13px] text-[var(--muted)]"}
            (if (:organization/default? org)
              "This organization is the default landing organization."
              "This organization is not the default landing organization yet.")]]]
         {:breadcrumbs [{:href "/" :label "Organizations"}
                        {:href (str "/organizations/" organization-id) :label (:organization/name org)}
                        {:label "Settings"}]
          :topbar-context (layout/render-fragment (ui/org-topbar-dropdown organizations org))}))
      (layout/page "Not found" [:p "Organization not found."]))))
