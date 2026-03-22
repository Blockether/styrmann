(ns com.blockether.styrmann.presentation.component.command-palette-test
  "Unit tests for the command-palette/shell component."
  (:require
   [com.blockether.styrmann.presentation.component.command-palette :as sut]
   [lazytest.core :refer [defdescribe describe expect expect-it it]]
   [clojure.string :as str]))

(defn- find-by-role [tree role]
  (cond
    (not (vector? tree)) nil
    (= role (get-in tree [1 :role])) tree
    :else (some #(find-by-role % role) (drop 2 tree))))

(defn- hiccup-children [tree]
  (let [tail (rest tree)]
    (if (and (seq tail) (map? (first tail)))
      (rest tail)
      tail)))

(defn- find-by-class [tree cls]
  (cond
    (not (vector? tree)) []
    :else
    (let [attrs    (when (map? (second tree)) (second tree))
          self     (when (and attrs (str/includes? (str (:class attrs)) cls)) [tree])
          children (mapcat #(find-by-class % cls) (hiccup-children tree))]
      (into (vec self) children))))

(defn- find-by-id [tree id]
  (cond
    (not (vector? tree)) nil
    (= id (get-in tree [1 :id])) tree
    :else (some #(find-by-id % id) (drop 2 tree))))

(defn- find-tag [tree tag]
  (cond
    (not (vector? tree)) nil
    (= tag (first tree)) tree
    :else (some #(find-tag % tag) (drop 2 tree))))

(defdescribe shell-test
  (describe "outer backdrop element"
    (it "has :role dialog"
      (let [result (sut/shell "cmd-palette" "Search...")]
        (expect (= "dialog" (get-in result [1 :role])))))

    (it "has :aria-modal true"
      (let [result (sut/shell "cmd-palette" "Search...")]
        (expect (= "true" (get-in result [1 :aria-modal])))))

    (it "has id equal to palette-id"
      (let [result (sut/shell "my-palette" "Search...")]
        (expect (= "my-palette" (get-in result [1 :id])))))

    (it "has default aria-label 'Command palette'"
      (let [result (sut/shell "p" "Search...")]
        (expect (= "Command palette" (get-in result [1 :aria-label])))))

    (it "uses custom aria-label when provided"
      (let [result (sut/shell "p" "Search..." {:aria-label "Quick find"})]
        (expect (= "Quick find" (get-in result [1 :aria-label])))))

    (it "outer element has class command-palette-backdrop"
      (let [result (sut/shell "p" "Search...")]
        (expect (str/includes? (get-in result [1 :class]) "command-palette-backdrop")))))

  (describe "search input"
    (it "renders a search input with default id"
      (let [result (sut/shell "my-palette" "Type a command...")
            input  (find-by-id result "my-palette-input")]
        (expect (some? input))
        (expect (= :input (first input)))
        (expect (= "search" (get-in input [1 :type])))))

    (it "renders placeholder text"
      (let [result (sut/shell "p" "Search tickets, tasks...")
            input  (find-by-id result "p-input")]
        (expect (= "Search tickets, tasks..." (get-in input [1 :placeholder])))))

    (it "input has autocomplete off"
      (let [result (sut/shell "p" "Search...")
            input  (find-by-id result "p-input")]
        (expect (= "off" (get-in input [1 :autocomplete])))))

    (it "input has autofocus true"
      (let [result (sut/shell "p" "Search...")
            input  (find-by-id result "p-input")]
        (expect (= true (get-in input [1 :autofocus])))))

    (it "uses custom input-id when provided"
      (let [result (sut/shell "p" "Search..." {:input-id "custom-search"})
            input  (find-by-id result "custom-search")]
        (expect (some? input)))))

  (describe "keyboard shortcut indicator"
    (it "renders a kbd element"
      (let [result (sut/shell "p" "Search...")
            kbd    (find-tag result :kbd)]
        (expect (some? kbd))))

    (it "kbd element has command-palette-kbd class"
      (let [result (sut/shell "p" "Search...")
            kbds   (find-by-class result "command-palette-kbd")]
        (expect (= 1 (count kbds))))))

  (describe "shell container"
    (it "renders inner shell with command-palette-shell class"
      (let [result (sut/shell "p" "Search...")
            shells (find-by-class result "command-palette-shell")]
        (expect (= 1 (count shells)))))

    (it "renders input row with command-palette-input-row class"
      (let [result (sut/shell "p" "Search...")
            rows   (find-by-class result "command-palette-input-row")]
        (expect (= 1 (count rows))))))

  (describe "optional actions"
    (it "renders actions when :actions opt is provided"
      (let [actions [:div {:id "action-list"} [:p "Action 1"]]
            result  (sut/shell "p" "Search..." {:actions actions})
            found   (find-by-id result "action-list")]
        (expect (some? found))))

    (it "does not render actions section when :actions is nil"
      (let [result   (sut/shell "p" "Search..." {:actions nil})
            sections (find-by-class result "command-palette-actions")]
        (expect (= 0 (count sections)))))

    (it "does not render actions when called without opts"
      (let [result   (sut/shell "p" "Search...")
            sections (find-by-class result "command-palette-actions")]
        (expect (= 0 (count sections))))))

  (describe "arity delegation"
    (it "two-arg call delegates to four-arg with nil opts"
      (let [result-2 (sut/shell "p" "Search...")
            result-4 (sut/shell "p" "Search..." nil)]
        (expect (= result-2 result-4))))))
