(ns com.blockether.styrmann.presentation.screen.organization-settings
  "SSR organization settings screen."
  (:require
   [com.blockether.styrmann.domain.organization :as organization]
   [com.blockether.styrmann.domain.provider :as provider]
   [com.blockether.styrmann.execution.session :as session]
   [com.blockether.styrmann.i18n :as i18n]
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
      [:span {:class "badge badge-green"} (i18n/t :settings/provider-default)]
      [:span {:class "text-[12px] text-[var(--muted)]"} (i18n/t :settings/provider-set-as-default)])]])

(defn- llm-providers-card [organization-id providers]
  [:div {:class "card p-6"}
   [:div {:class "flex items-center justify-between mb-4"}
    [:h2 {:class "text-[16px] font-medium"} (i18n/t :settings/llm-providers)]
    [:span {:class "text-[13px] text-[var(--muted)]"}
     (str (count providers) " provider" (when-not (= 1 (count providers)) "s"))]]
   [:p {:class "mb-4 text-[13px] text-[var(--muted)]"}
    (i18n/t :settings/provider-description)]
   (if (seq providers)
     [:table {:class "w-full text-[13px]"}
      [:thead]
      [:tbody
       (for [p providers]
         (provider-row p))]]
     [:p {:class "text-[13px] text-[var(--muted)] italic mb-4"} (i18n/t :settings/no-providers)])
   [:form {:class "mt-6 pt-6 border-t border-[var(--border)] space-y-4" :method "post" :action (str "/organizations/" organization-id "/settings/provider")}
    [:h3 {:class "text-[14px] font-medium mb-3"} (i18n/t :settings/add-provider)]
    (text-field (i18n/t :settings/provider-name) "name" "" "OpenAI")
    (text-field (i18n/t :settings/provider-base-url) "base-url" "" "https://api.openai.com/v1")
    (text-field (i18n/t :settings/provider-api-key) "api-key" "" "sk-...")
    [:div {:class "flex items-center gap-3 pt-1"}
     [:label {:class "flex items-center gap-2 text-[13px] cursor-pointer"}
      [:input {:type "checkbox" :name "default?" :value "true"}]
      (i18n/t :settings/provider-set-default)]
     [:div {:class "flex-1"}]
     [:button {:class "btn-primary" :type "submit"} (i18n/t :settings/add-provider)]]]])

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
     [:h2 {:class "text-[16px] font-medium mb-3"} (i18n/t :settings/runner-settings)]
     [:p {:class "mb-4 text-[13px] text-[var(--muted)]"}
      (i18n/t :settings/runner-description)]
     (if (seq workspaces)
       [:form {:class "space-y-4" :method "post" :action (str "/organizations/" organization-id "/settings/runner")}
        (select-field
         (i18n/t :settings/runner-workspace)
         "workspace-id"
         (mapv (fn [w] [(str (:workspace/id w)) (:workspace/name w)]) workspaces)
         (str (:workspace/id current-workspace)))
        (select-field
         (i18n/t :settings/runner-provider)
         "provider-id"
         provider-options
         (str (get-in current-env [:execution-environment/provider :provider/id])))
        (text-field
         (i18n/t :settings/runner-model)
         "model"
         (:execution-environment/model current-env)
         "gpt-4o-mini")
        (optional-text-field
         (i18n/t :settings/runner-working-directory)
         "working-directory"
         (:execution-environment/working-directory current-env)
         "/opt/styrmann")
        (select-field
         (i18n/t :settings/runner-status)
         "status"
         [["execution-environment.status/ready" (i18n/t :settings/status-ready)]
          ["execution-environment.status/busy" (i18n/t :settings/status-busy)]
          ["execution-environment.status/offline" (i18n/t :settings/status-offline)]
          ["execution-environment.status/error" (i18n/t :settings/status-error)]]
         (str (or (:execution-environment/status current-env)
                  :execution-environment.status/ready)))
        [:div {:class "flex justify-end"}
         [:button {:class "btn-primary" :type "submit"} (i18n/t :settings/runner-save)]]]
       (ui/empty-state (i18n/t :settings/runner-no-workspace)))]))

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
           [:h1 {:class "text-[28px] leading-tight"} (i18n/t :settings/title)]
           [:p {:class "mt-2 text-[14px] text-[var(--muted)]"}
            (i18n/t :settings/manage-description)]]
          [:div {:class "card p-0 overflow-hidden"}
           [:div {:class "flex border-b border-[var(--border)]"}
            (tab-link (str "/organizations/" organization-id "/settings?tab=providers")
                      (i18n/t :settings/llm-providers)
                      (= active-tab :providers))
            (tab-link (str "/organizations/" organization-id "/settings?tab=runner")
                      (i18n/t :settings/runner-settings)
                      (= active-tab :runner))]
           [:div {:class "p-6"}
            (case active-tab
              :providers (llm-providers-card organization-id providers)
              :runner (runner-settings-card organization-id org environments providers))]]
          [:div {:class "card p-6"}
           [:div {:class "field-label mb-3"} (i18n/t :settings/current-organization)]
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
