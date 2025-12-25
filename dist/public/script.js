// Global variables
let tasks = [];
let selectedTaskId = null;
let searchTerm = "";
let sortOption = "execution-order";
let globalAnalysisResult = null; // Added: Store global analysis result
let svg, g, simulation; // Modified: Define D3 related variables
let conversationHistory = []; // Added: Store conversation history for selected task

// Project and Client state
let projects = [];
let clients = []; // Store client list
let selectedProjectId = "all";
let clientCount = 0;
let isEditingTask = false;

// Added: i18n global variables
let currentLang = "en"; // Default language
let translations = {}; // Store loaded translations

// DOM elements
const taskListElement = document.getElementById("task-list");
const taskDetailsContent = document.getElementById("task-details-content");
const statusFilter = document.getElementById("status-filter");
const currentTimeElement = document.getElementById("current-time");
const progressIndicator = document.getElementById("progress-indicator");
const progressCompleted = document.getElementById("progress-completed");
const progressInProgress = document.getElementById("progress-in-progress");
const progressPending = document.getElementById("progress-pending");
const progressLabels = document.getElementById("progress-labels");
const dependencyGraphElement = document.getElementById("dependency-graph");
const globalAnalysisResultElement = document.getElementById(
  "global-analysis-result"
); // Assuming this element exists in HTML
const langSwitcher = null; // Removed language switcher

// Project selector elements
const projectFilter = document.getElementById("project-filter");
const clientCountElement = document.getElementById("client-count");

// Task edit form elements
const taskEditForm = document.getElementById("task-edit-form");
const editTaskName = document.getElementById("edit-task-name");
const editTaskStatus = document.getElementById("edit-task-status");
const editTaskDescription = document.getElementById("edit-task-description");
const editTaskNotes = document.getElementById("edit-task-notes");
const editTaskProblemStatement = document.getElementById("edit-task-problem-statement");
const editTaskTechnicalPlan = document.getElementById("edit-task-technical-plan");
const editTaskFinalOutcome = document.getElementById("edit-task-final-outcome");
const editTaskLessonsLearned = document.getElementById("edit-task-lessons-learned");
const btnSaveTask = document.getElementById("btn-save-task");
const btnCancelEdit = document.getElementById("btn-cancel-edit");
const saveFeedback = document.getElementById("save-feedback");

// Initialization
document.addEventListener("DOMContentLoaded", () => {
  // fetchTasks(); // Will be triggered by initI18n()
  initI18n(); // Added: Initialize i18n
  updateCurrentTime();
  setInterval(updateCurrentTime, 1000);

  // Fetch projects and client count on load
  fetchProjects();
  fetchClientCount();

  // Event listeners
  // statusFilter.addEventListener("change", renderTasks); // Will be triggered by changeLanguage or after applyTranslations
  if (statusFilter) {
    statusFilter.addEventListener("change", renderTasks);
  }

  // Added: Search and sort event listeners
  const searchInput = document.getElementById("search-input");
  const sortOptions = document.getElementById("sort-options");

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      searchTerm = e.target.value.toLowerCase();
      renderTasks();
    });
  }

  if (sortOptions) {
    sortOptions.addEventListener("change", (e) => {
      sortOption = e.target.value;
      renderTasks();
    });
  }

  // Project filter event listener
  if (projectFilter) {
    projectFilter.addEventListener("change", (e) => {
      selectedProjectId = e.target.value;
      localStorage.setItem("selectedProjectId", selectedProjectId);
      fetchTasks(); // Re-fetch with new filter
    });

    // Restore saved project selection
    const savedProjectId = localStorage.getItem("selectedProjectId");
    if (savedProjectId) {
      selectedProjectId = savedProjectId;
    }
  }

  // Task edit form handlers
  if (taskEditForm) {
    taskEditForm.addEventListener("submit", handleSaveTask);
  }
  if (btnCancelEdit) {
    btnCancelEdit.addEventListener("click", handleCancelEdit);
  }

  // Added: Set up SSE connection
  setupSSE();

  // Fallback polling: if tasks are updated by a different server process,
  // SSE events won't propagate cross-process. Poll periodically to keep UI fresh.
  setInterval(fetchTasks, 10000);
  setInterval(fetchProjects, 30000);
  setInterval(fetchClientCount, 30000);

  // Added: Language switcher event listener
  // Theme Logic
  initTheme();

  // Settings Menu Logic
  initSettings();

  // Sidebar Toggle Logic
  const sidebarToggle = document.getElementById("sidebar-toggle");
  const sidebar = document.querySelector("aside");
  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener("click", () => {
      sidebar.classList.toggle("collapsed");
      // Wait for transition to finish then re-render graph
      setTimeout(() => {
        if (typeof renderDependencyGraph === 'function') renderDependencyGraph();
      }, 350);
    });
  }

  // Draggable Divider Logic
  const divider = document.getElementById("drag-divider");
  const depView = document.querySelector(".dependency-view");
  const workspace = document.querySelector(".workspace-content");

  if (divider && depView && workspace) {
    let isDragging = false;

    divider.addEventListener("mousedown", (e) => {
      isDragging = true;
      divider.classList.add("active");
      document.body.style.cursor = "col-resize";
      e.preventDefault(); // Prevent text selection
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const workspaceRect = workspace.getBoundingClientRect();
      const newWidth = e.clientX - workspaceRect.left;

      // Constraints (min 250px)
      if (newWidth > 250 && newWidth < workspaceRect.width - 250) {
        depView.style.width = `${newWidth}px`;
        depView.style.flex = "none";
      }
    });

    document.addEventListener("mouseup", () => {
      if (isDragging) {
        isDragging = false;
        divider.classList.remove("active");
        document.body.style.cursor = "";
        if (typeof renderDependencyGraph === 'function') renderDependencyGraph();
      }
    });
  }
});

// ==================== CLIENT FUNCTIONS ====================

// ==================== PROJECT FUNCTIONS ====================

async function fetchProjects() {
  try {
    const response = await fetch("/api/projects", { cache: "no-store" });
    if (!response.ok) throw new Error("Failed to fetch projects");

    const data = await response.json();
    projects = data.projects || [];

    if (!projectFilter) return;

    // Rebuild dropdown
    projectFilter.innerHTML = "";

    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = translate("project_filter_all") || "All projects";
    projectFilter.appendChild(allOpt);

    for (const project of projects) {
      const opt = document.createElement("option");
      opt.value = project.id;

      // Show task count if API provides it
      const count = typeof project.taskCount === "number" ? project.taskCount : null;
      opt.textContent = count === null ? project.name : `${project.name} (${count})`;
      projectFilter.appendChild(opt);
    }

    // Restore selection if possible
    const hasSelected = selectedProjectId === "all" || projects.some((p) => p.id === selectedProjectId);
    if (!hasSelected) {
      selectedProjectId = "all";
      localStorage.setItem("selectedProjectId", selectedProjectId);
    }
    projectFilter.value = selectedProjectId;

    // Refresh tasks using the selected project filter
    fetchTasks();
  } catch (error) {
    console.error("Error fetching projects:", error);
  }
}

async function fetchClientCount() {
  try {
    const response = await fetch("/api/clients/count", { cache: "no-store" });
    if (!response.ok) throw new Error("Failed to fetch client count");

    const data = await response.json();
    const count = typeof data.count === "number" ? data.count : 0;
    updateClientCount(count);
  } catch (error) {
    console.error("Error fetching client count:", error);
  }
}

// Helper function to update client count display
function updateClientCount(count) {
  const clientCountNum = document.getElementById("client-count");
  if (clientCountNum) {
    clientCountNum.textContent = String(count);
  }
}

// Helper function to update connection status indicator
function updateConnectionStatus(isOnline) {
  const statusIndicator = document.querySelector(".status-indicator");
  const statusText = document.querySelector(".status-bar span");
  const statusBar = document.querySelector(".status-bar");

  if (statusIndicator) {
    statusIndicator.classList.toggle("offline", !isOnline);
  }

  if (statusBar) {
    statusBar.classList.toggle("offline", !isOnline);
  }

  if (statusText) {
    statusText.textContent = isOnline
      ? (translate("status_indicator_online") || "ONLINE")
      : (translate("status_indicator_offline") || "OFFLINE");
  }
}

async function fetchClients() {
  try {
    const response = await fetch("/api/clients", { cache: "no-store" });
    if (!response.ok) throw new Error("Failed to fetch clients");

    const data = await response.json();
    clients = data.clients || []; // Update global clients list

    // Only update the tooltip here - count is updated via SSE or fetchClientCount()
    const clientCountNum = document.getElementById("client-count");
    if (clientCountNum) {
      const activeClients = clients.filter(c => c.isActive);
      clientCountNum.title = activeClients.map(c => `${c.name} (${c.type})`).join('\n');
    }

  } catch (error) {
    console.error("Error fetching clients:", error);
  }
}

function getClientIcon(type) {
  if (!type) return "💻";
  const t = type.toLowerCase();
  if (t.includes("vscode")) return "🔵";
  if (t.includes("cursor")) return "⚪";
  if (t.includes("claude")) return "🟣";
  if (t.includes("jetbrains")) return "🟧";
  if (t.includes("visual studio")) return "💜";
  return "💻";
}

// ==================== DRAG AND DROP FUNCTIONS ====================

let draggedItem = null;

function handleDragStart(e) {
  draggedItem = this;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/html', this.innerHTML);
  this.style.opacity = '0.4';
}

function handleDragOver(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }
  e.dataTransfer.dropEffect = 'move';
  return false;
}

function handleDrop(e) {
  if (e.stopPropagation) {
    e.stopPropagation();
  }

  if (draggedItem !== this && draggedItem !== null) {
    const allItems = [...document.querySelectorAll('.task-item')];
    const fromIndex = allItems.indexOf(draggedItem);
    const toIndex = allItems.indexOf(this);

    if (fromIndex !== -1 && toIndex !== -1) {
      const draggedTaskId = draggedItem.getAttribute('data-id');
      const targetTaskId = this.getAttribute('data-id');

      // Validate: Check if this drop would violate dependency constraints
      const draggedTask = tasks.find(t => t.id === draggedTaskId);
      const targetTask = tasks.find(t => t.id === targetTaskId);

      if (draggedTask && targetTask) {
        // Check if dragged task depends on target task (can't move before its parent)
        const draggedDependsOnTarget = draggedTask.dependencies?.some(dep => {
          const depId = typeof dep === 'object' ? dep.taskId : dep;
          return depId === targetTaskId;
        });

        // If trying to move dependent task BEFORE its parent, block it
        if (draggedDependsOnTarget && toIndex < fromIndex) {
          console.warn(`Cannot move "${draggedTask.name}" before its dependency "${targetTask.name}"`);
          showTemporaryError(`Cannot move task before its dependency "${targetTask.name}"`);
          return false;
        }

        // Check if target task depends on dragged task (can't move parent after child)
        const targetDependsOnDragged = targetTask.dependencies?.some(dep => {
          const depId = typeof dep === 'object' ? dep.taskId : dep;
          return depId === draggedTaskId;
        });

        // If trying to move parent task AFTER its dependent child, block it
        if (targetDependsOnDragged && toIndex > fromIndex) {
          console.warn(`Cannot move "${draggedTask.name}" after its dependent "${targetTask.name}"`);
          showTemporaryError(`Cannot move task after its dependent "${targetTask.name}"`);
          return false;
        }
      }

      // Valid drop - proceed
      if (fromIndex < toIndex) {
        this.parentNode.insertBefore(draggedItem, this.nextSibling);
      } else {
        this.parentNode.insertBefore(draggedItem, this);
      }

      showApplyButton();
    }
  }

  return false;
}

function handleDragEnd(e) {
  this.style.opacity = '1';
  draggedItem = null;
}

function showApplyButton() {
  const btn = document.getElementById('btn-apply-order');
  if (btn) {
    btn.style.display = 'flex';
    btn.onclick = handleApplyOrder;
  }
}

async function handleApplyOrder() {
  console.log("Applying new order...");
  const btn = document.getElementById('btn-apply-order');
  if (btn) btn.disabled = true;

  const newTaskIds = [...document.querySelectorAll('.task-item')]
    .map(item => item.getAttribute('data-id'))
    .filter(id => id);

  await reorderTasks(newTaskIds);

  if (btn) {
    btn.style.display = 'none';
    btn.disabled = false;
  }
}

async function reorderTasks(taskIds) {
  try {
    console.log("Reordering tasks...", taskIds, "project:", selectedProjectId);
    // Optimistic update locally? 
    // We already moved it in DOM, but `tasks` array is stale until we re-fetch or manually update it.
    // Let's rely on the fetch after API call for full consistency, 
    // but maybe we should update `tasks` locally to match visual state if we want to avoid flicker

    const response = await fetch("/api/tasks/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskIds, projectId: selectedProjectId !== "all" ? selectedProjectId : undefined })
    });

    if (!response.ok) {
      throw new Error("Failed to reorder tasks");
    }

    const result = await response.json();
    console.log("Reorder success:", result);

    // Optionally re-fetch to ensure backend state matches (execution_order updated)
    fetchTasks();

  } catch (error) {
    console.error("Error reordering:", error);
    showTemporaryError("Failed to save new order (check console)");
    // Revert visual change? (complex to do without full re-render)
    fetchTasks(); // Force reset to server state
  }
}


// ==================== TASK EDIT FUNCTIONS ====================

function toFormStatusValue(status) {
  if (!status) return "pending";

  // Backend / stored values (Title Case)
  switch (status) {
    case "Pending":
      return "pending";
    case "In Progress":
      return "in_progress";
    case "Completed":
      return "completed";
    case "Blocked":
      return "blocked";
  }

  // Frontend / API variants
  if (typeof status === "string") {
    const s = status.trim().toLowerCase();
    if (s === "pending") return "pending";
    if (s === "in_progress" || s === "in progress") return "in_progress";
    if (s === "completed") return "completed";
    if (s === "blocked") return "blocked";
  }

  return "pending";
}

function toApiStatusValue(formValue) {
  if (!formValue) return "Pending";

  // If already Title Case, keep it
  switch (formValue) {
    case "Pending":
    case "In Progress":
    case "Completed":
    case "Blocked":
      return formValue;
  }

  // Map UI values -> backend enum strings
  switch (formValue) {
    case "pending":
      return "Pending";
    case "in_progress":
      return "In Progress";
    case "completed":
      return "Completed";
    case "blocked":
      return "Blocked";
    default:
      return "Pending";
  }
}

// Added: Render dependencies checklist
function renderDependencySelector(currentTask) {
  const container = document.getElementById("edit-task-dependencies-container");
  if (!container) return;

  container.innerHTML = ""; // Clear existing

  // Filter possible dependencies (exclude self)
  const availableTasks = tasks.filter(t => t.id !== currentTask.id);

  if (availableTasks.length === 0) {
    container.innerHTML = `<p class="placeholder" style="font-size: 0.9em; opacity: 0.7;">${translate("no_other_tasks_available") || "No other tasks available"}</p>`;
    return;
  }

  // Normalize current dependencies to a Set of IDs
  const currentDepIds = new Set();
  if (currentTask.dependencies) {
    currentTask.dependencies.forEach(dep => {
      const depId = typeof dep === 'object' && dep ? dep.taskId : dep;
      currentDepIds.add(depId);
    });
  }

  availableTasks.forEach(task => {
    const div = document.createElement("div");
    div.className = "dependency-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = `dep-check-${task.id}`;
    checkbox.value = task.id;
    checkbox.checked = currentDepIds.has(task.id);

    const label = document.createElement("label");
    label.htmlFor = `dep-check-${task.id}`;
    label.textContent = task.name;

    div.appendChild(checkbox);
    div.appendChild(label);
    container.appendChild(div);
  });
}

function showTaskEditForm(task) {
  if (!taskEditForm || !task) return;

  isEditingTask = true;

  // Populate form fields
  if (editTaskName) editTaskName.value = task.name || "";
  if (editTaskStatus) editTaskStatus.value = toFormStatusValue(task.status);
  if (editTaskDescription) editTaskDescription.value = task.description || "";
  if (editTaskNotes) editTaskNotes.value = task.notes || "";
  if (editTaskProblemStatement) editTaskProblemStatement.value = task.problemStatement || "";
  if (editTaskTechnicalPlan) editTaskTechnicalPlan.value = task.technicalPlan || "";
  if (editTaskFinalOutcome) editTaskFinalOutcome.value = task.finalOutcome || "";
  if (editTaskLessonsLearned) editTaskLessonsLearned.value = task.lessonsLearned || "";

  // Render dependencies selector
  renderDependencySelector(task);

  // Show form, hide placeholder
  taskEditForm.style.display = "block";
  if (taskDetailsContent) taskDetailsContent.style.display = "none";
  if (saveFeedback) saveFeedback.textContent = "";
}

function hideTaskEditForm() {
  if (!taskEditForm) return;

  isEditingTask = false;
  taskEditForm.style.display = "none";
  if (taskDetailsContent) taskDetailsContent.style.display = "block";
  if (saveFeedback) saveFeedback.textContent = "";
}

async function handleSaveTask(e) {
  e.preventDefault();

  if (!selectedTaskId) {
    showFeedback("No task selected", "error");
    return;
  }

  const updates = {
    name: editTaskName?.value || "",
    status: toApiStatusValue(editTaskStatus?.value),
    description: editTaskDescription?.value || "",
    notes: editTaskNotes?.value || "",
    problemStatement: editTaskProblemStatement?.value || "",
    technicalPlan: editTaskTechnicalPlan?.value || "",
    finalOutcome: editTaskFinalOutcome?.value || "",
    lessonsLearned: editTaskLessonsLearned?.value || "",
    dependencies: Array.from(document.querySelectorAll('#edit-task-dependencies-container input:checked')).map(cb => cb.value)
  };

  try {
    // Disable save button
    if (btnSaveTask) btnSaveTask.disabled = true;
    showFeedback("Saving...", "info");

    const response = await fetch(`/api/tasks/${selectedTaskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to save task");
    }

    const result = await response.json();

    // Update local task data
    const taskIndex = tasks.findIndex(t => t.id === selectedTaskId);
    if (taskIndex !== -1) tasks[taskIndex] = result.task || { ...tasks[taskIndex], ...updates };

    showFeedback("Saved successfully!", "success");

    // Exit edit mode and refresh details.
    // NOTE: selectTask() toggles off when called with the already-selected id.
    // To re-render the same task after save, clear selectedTaskId first.
    const refreshId = selectedTaskId;
    hideTaskEditForm();
    selectedTaskId = null;
    await selectTask(refreshId);

    // Re-render to reflect changes
    renderTasks();
    updateProgressIndicator();
    renderDependencyGraph();

  } catch (error) {
    console.error("Error saving task:", error);
    showFeedback("Failed to save: " + error.message, "error");
  } finally {
    if (btnSaveTask) btnSaveTask.disabled = false;
  }
}

function handleCancelEdit() {
  hideTaskEditForm();
  if (selectedTaskId) {
    const refreshId = selectedTaskId;
    selectedTaskId = null;
    selectTask(refreshId);
  }
  showFeedback("", "");
}

function showFeedback(message, type) {
  if (!saveFeedback) return;
  saveFeedback.textContent = message;
  saveFeedback.className = "save-feedback " + type;
}



// Added: i18n core functions
// 1. Language detection (localStorage > navigator.language > 'en')
function detectLanguage() {
  const savedLang = localStorage.getItem("lang");
  if (savedLang && ["en", "zh-TW"].includes(savedLang)) {
    // Ensure saved language is valid
    return savedLang;
  }
  // Check browser language
  const browserLang = navigator.language || navigator.userLanguage;
  if (browserLang) {
    if (browserLang.toLowerCase().startsWith("zh-tw")) return "zh-TW";
    if (browserLang.toLowerCase().startsWith("zh")) return "zh-TW"; // Simplified Chinese also falls back to Traditional for now
    if (browserLang.toLowerCase().startsWith("en")) return "en";
  }
  return "en"; // Default
}

// 2. Asynchronously load translation files
async function loadTranslations(lang) {
  try {
    const response = await fetch(`/locales/${lang}.json`);
    if (!response.ok) {
      throw new Error(
        `Failed to load ${lang}.json, status: ${response.status}`
      );
    }
    translations = await response.json();
    console.log(`Translations loaded for ${lang}`);
  } catch (error) {
    console.error("Error loading translations:", error);
    if (lang !== "en") {
      console.warn(`Falling back to English translations.`);
      await loadTranslations("en"); // Fallback to English
    } else {
      translations = {}; // Clear translations if even English fails
      // Maybe display a more persistent error message?
      alert("Critical error: Could not load language files.");
    }
  }
}

// 3. Translation function
function translate(key, replacements = {}) {
  let translated = translations[key] || key; // Fallback to key itself
  // Simple placeholder replacement (e.g., {message})
  for (const placeholder in replacements) {
    translated = translated.replace(
      `{${placeholder}}`,
      replacements[placeholder]
    );
  }
  return translated;
}

// 4. Apply translations to DOM (process textContent, placeholder, title)
function applyTranslations() {
  console.log("Applying translations for:", currentLang);
  document.querySelectorAll("[data-i18n-key]").forEach((el) => {
    const key = el.dataset.i18nKey;
    const translatedText = translate(key);

    // Prioritize specific attributes
    if (el.hasAttribute("placeholder")) {
      el.placeholder = translatedText;
    } else if (el.hasAttribute("title")) {
      el.title = translatedText;
    } else if (el.tagName === "OPTION") {
      el.textContent = translatedText;
      // If needed, also translate value, but usually not
    } else {
      // For most elements, set textContent
      el.textContent = translatedText;
    }
  });
  // Manually update elements without data-key (if any)
  // For example, if footer time format needs localization, can handle here
  // updateCurrentTime(); // Ensure time format might also update (if needed)
}

// 5. Initialize i18n
async function initI18n() {
  currentLang = detectLanguage();
  console.log(`Initializing i18n with language: ${currentLang}`);
  localStorage.setItem("lang", currentLang); // Ensure lang is saved
  // Added: Set initial value for the switcher
  if (langSwitcher) {
    langSwitcher.value = currentLang;
  }
  await loadTranslations(currentLang);
  applyTranslations();
  await loadTranslations(currentLang);
  applyTranslations();

  // Fetch clients first to populate icons
  await fetchClients();
  // Then tasks
  await fetchTasks();

  // Set interval to refresh clients
  setInterval(fetchClients, 30000);
}

// Added: Language switcher function
function changeLanguage(lang) {
  if (!lang || !["en", "zh-TW"].includes(lang)) {
    console.warn(`Invalid language selected: ${lang}. Defaulting to English.`);
    lang = "en";
  }
  currentLang = lang;
  localStorage.setItem("lang", lang);
  console.log(`Changing language to: ${currentLang}`);
  loadTranslations(currentLang)
    .then(() => {
      console.log("Translations reloaded, applying...");
      applyTranslations();
      console.log("Re-rendering components...");
      // Re-render components that need translation
      renderTasks();
      if (selectedTaskId) {
        const task = tasks.find((t) => t.id === selectedTaskId);
        if (task) {
          selectTask(selectedTaskId); // Ensure passing ID, let selectTask re-find and render
        } else {
          // If selected task no longer exists, clear details
          taskDetailsContent.innerHTML = `<p class="placeholder">${translate(
            "task_details_placeholder"
          )}</p>`;
          selectedTaskId = null;
          highlightNode(null);
        }
      } else {
        // If no task is selected, ensure details panel shows placeholder
        taskDetailsContent.innerHTML = `<p class="placeholder">${translate(
          "task_details_placeholder"
        )}</p>`;
      }
      renderDependencyGraph(); // Re-render graph (might contain placeholder)
      updateProgressIndicator(); // Re-render progress bar (includes labels)
      renderGlobalAnalysisResult(); // Re-render global analysis (title)
      // Ensure dropdown value is consistent with current language
      if (langSwitcher) langSwitcher.value = currentLang;
      console.log("Language change complete.");
    })
    .catch((error) => {
      console.error("Error changing language:", error);
    });
}

// ==================== THEME FUNCTIONS ====================

function initTheme() {
  const savedTheme = localStorage.getItem("theme") || "dark";
  document.documentElement.setAttribute("data-theme", savedTheme);
  updateThemeIcon(savedTheme);

  const themeToggleBtn = document.getElementById("theme-toggle");
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", toggleTheme);
  }
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
  const newTheme = currentTheme === "dark" ? "light" : "dark";

  document.documentElement.setAttribute("data-theme", newTheme);
  localStorage.setItem("theme", newTheme);
  updateThemeIcon(newTheme);
}

function updateThemeIcon(theme) {
  const themeToggleBtn = document.getElementById("theme-toggle");
  if (themeToggleBtn) {
    const iconSpan = themeToggleBtn.querySelector(".icon");
    if (iconSpan) {
      iconSpan.textContent = theme === "dark" ? "🌙" : "☀️";
    }
  }
}



// ==================== SETTINGS FUNCTIONS ====================

function initSettings() {
  const settingsBtn = document.getElementById("settings-btn");
  const settingsDropdown = document.getElementById("settings-dropdown");
  const btnRestart = document.getElementById("btn-restart-server");
  const btnStop = document.getElementById("btn-stop-server");

  if (settingsBtn && settingsDropdown) {
    // Toggle dropdown
    settingsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      settingsDropdown.classList.toggle("hidden");
      settingsDropdown.classList.toggle("show");
    });

    // Close when clicking outside
    document.addEventListener("click", (e) => {
      if (!settingsBtn.contains(e.target) && !settingsDropdown.contains(e.target)) {
        settingsDropdown.classList.add("hidden");
        settingsDropdown.classList.remove("show");
      }
    });
  }

  if (btnRestart) {
    btnRestart.addEventListener("click", async () => {
      if (confirm("Are you sure you want to RESTART the server? This will disconnect all clients briefly.")) {
        try {
          const res = await fetch("/api/server/restart", { method: "POST" });
          const data = await res.json();
          if (data.success) {
            alert("Server restarting... The page may need to be reloaded.");
            // Optional: reload page after a delay
            setTimeout(() => window.location.reload(), 3000);
          } else {
            alert("Failed to restart: " + (data.error || "Unknown error"));
          }
        } catch (e) {
          alert("Error requesting restart: " + e.message);
        }
      }
    });
  }

  if (btnStop) {
    btnStop.addEventListener("click", async () => {
      if (confirm("Are you sure you want to STOP the server? You will need to start it manually again.")) {
        try {
          const res = await fetch("/api/server/stop", { method: "POST" });
          const data = await res.json();
          if (data.success) {
            alert("Server stopping... Goodbye!");
            document.body.innerHTML = "<h1 style='color:white;text-align:center;padding-top:20%;'>Server Stopped</h1>";
          } else {
            alert("Failed to stop: " + (data.error || "Unknown error"));
          }
        } catch (e) {
          alert("Error requesting stop: " + e.message);
        }
      }
    });
  }
}
// --- i18n core functions end ---

// Get task data
async function fetchTasks() {
  try {
    // Show loading (now using translation)
    if (tasks.length === 0) {
      taskListElement.innerHTML = `<div class="loading">${translate(
        "task_list_loading"
      )}</div>`;
    }

    // Build URL (optionally filter by selected project)
    const url = new URL("/api/tasks", window.location.origin);

    if (selectedProjectId && selectedProjectId !== "all") {
      url.searchParams.set("project_id", selectedProjectId);
    }

    const response = await fetch(url.toString(), { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const data = await response.json();
    const newTasks = data.tasks || [];

    // Extract global analysis result (find first non-empty)
    // Global analysis result logic removed (moved to task details)

    // --- Smart update logic (initial - still needs improvement to avoid flickering) ---
    // Simply compare task count or identifier to decide whether to re-render
    // Ideal situation should compare content of each task and perform DOM update
    const tasksChanged = didTasksChange(tasks, newTasks);

    if (tasksChanged) {
      tasks = newTasks; // Update global task list
      console.log("Tasks updated via fetch, re-rendering...");
      renderTasks();
      updateProgressIndicator();
      renderDependencyGraph(); // Update graph
    } else {
      console.log(
        "No significant task changes detected, skipping full re-render."
      );
      // Fix: If we showed "Loading..." prompt (tasks.length === 0), we MUST render even if result is still empty
      // to clear the "Loading..." text and show "Empty" placeholder.
      if (taskListElement.innerHTML.includes("loading")) {
        console.log("Clearing loading state...");
        renderTasks();
        renderDependencyGraph();
      } else {
        // Fix: If graph is empty but we have tasks (e.g. D3 loaded late), force render
        const graphHasContent = dependencyGraphElement && dependencyGraphElement.querySelector("svg");
        if (!graphHasContent && tasks.length > 0) {
          console.log("Graph empty but tasks exist, forcing render...");
          renderDependencyGraph();
        }
      }

      // If no need to re-render list, possibly just update progress bar
      updateProgressIndicator();
    }

    // *** Remove setTimeout polling ***
    // setTimeout(fetchTasks, 30000);
  } catch (error) {
    console.error("Error fetching tasks:", error);
    // Avoid overwriting existing list unless initial load fails
    if (tasks.length === 0) {
      taskListElement.innerHTML = `<div class="error">${translate(
        "error_loading_tasks",
        { message: error.message }
      )}</div>`;
      if (progressIndicator) progressIndicator.style.display = "none";
      if (dependencyGraphElement)
        dependencyGraphElement.innerHTML = `<div class="error">${translate(
          "error_loading_graph"
        )}</div>`;
    } else {
      showTemporaryError(
        translate("error_updating_tasks", { message: error.message })
      );
    }
  }
}

// Added: Set up Server-Sent Events connection
function setupSSE() {
  console.log("Setting up SSE connection to /api/tasks/stream");
  const evtSource = new EventSource("/api/tasks/stream");

  evtSource.onmessage = function (event) {
    console.log("SSE message received:", event.data);
    // Can do more complex judgment based on event.data content, currently just update if receive message
  };

  evtSource.addEventListener("update", function (event) {
    console.log("SSE 'update' event received:", event.data);
    // Receive update event, re-fetch task list
    fetchTasks();
  });

  // Listen for client count updates
  evtSource.addEventListener("client-update", function (event) {
    console.log("SSE 'client-update' event received:", event.data);
    try {
      const data = JSON.parse(event.data);
      if (typeof data.count === "number") {
        updateClientCount(data.count);
      }
    } catch (e) {
      console.error("Failed to parse client-update event:", e);
      fetchClientCount(); // Fallback to polling
    }
  });

  evtSource.onerror = function (err) {
    console.error("EventSource failed:", err);
    // Update connection status to offline
    updateConnectionStatus(false);
    // Can implement re-connect logic
    evtSource.close(); // Close error connection
    // Delay a bit later to try re-connect
    setTimeout(setupSSE, 5000); // 5 seconds later retry
  };

  evtSource.onopen = function () {
    console.log("SSE connection opened.");
    // Update connection status to online
    updateConnectionStatus(true);
    // Refresh client count on reconnect
    fetchClientCount();
  };
}

// Added: Helper function to compare task lists for changes (most comprehensive version)
function didTasksChange(oldTasks, newTasks) {
  if (!oldTasks || !newTasks) return true; // Handle initial load or error states

  if (oldTasks.length !== newTasks.length) {
    console.log("Task length changed.");
    return true; // Length change definitely needs update
  }

  const oldTaskMap = new Map(oldTasks.map((task) => [task.id, task]));
  const newTaskIds = new Set(newTasks.map((task) => task.id)); // For checking removed tasks

  // Check for removed tasks first
  for (const oldTask of oldTasks) {
    if (!newTaskIds.has(oldTask.id)) {
      console.log(`Task removed: ${oldTask.id}`);
      return true;
    }
  }

  // Check for new or modified tasks
  for (const newTask of newTasks) {
    const oldTask = oldTaskMap.get(newTask.id);
    if (!oldTask) {
      console.log(`New task found: ${newTask.id}`);
      return true; // New task ID found
    }

    // Compare relevant fields
    const fieldsToCompare = [
      "name",
      "description",
      "status",
      "notes",
      "implementationGuide",
      "verificationCriteria",
      "summary",
      "problemStatement",
      "technicalPlan",
      "finalOutcome",
      "lessonsLearned",
    ];

    for (const field of fieldsToCompare) {
      if (oldTask[field] !== newTask[field]) {
        // Handle null/undefined comparisons carefully if needed
        // e.g., !(oldTask[field] == null && newTask[field] == null) checks if one is null/undefined and the other isn't
        if (
          !(oldTask[field] === null && newTask[field] === null) &&
          !(oldTask[field] === undefined && newTask[field] === undefined)
        ) {
          console.log(`Task ${newTask.id} changed field: ${field}`);
          return true;
        }
      }
    }

    // Compare dependencies (array of strings or objects)
    if (!compareDependencies(oldTask.dependencies, newTask.dependencies)) {
      console.log(`Task ${newTask.id} changed field: dependencies`);
      return true;
    }

    // Compare relatedFiles (array of objects) - simple length check first
    if (!compareRelatedFiles(oldTask.relatedFiles, newTask.relatedFiles)) {
      console.log(`Task ${newTask.id} changed field: relatedFiles`);
      return true;
    }

    // Optional: Compare updatedAt as a final check if other fields seem identical
    if (oldTask.updatedAt?.toString() !== newTask.updatedAt?.toString()) {
      console.log(`Task ${newTask.id} changed field: updatedAt (fallback)`);
      return true;
    }
  }

  return false; // No significant changes detected
}

// Helper function to compare dependency arrays
function compareDependencies(deps1, deps2) {
  const arr1 = deps1 || [];
  const arr2 = deps2 || [];

  if (arr1.length !== arr2.length) return false;

  // Extract IDs whether they are strings or objects {taskId: string}
  const ids1 = new Set(
    arr1.map((dep) =>
      typeof dep === "object" && dep !== null ? dep.taskId : dep
    )
  );
  const ids2 = new Set(
    arr2.map((dep) =>
      typeof dep === "object" && dep !== null ? dep.taskId : dep
    )
  );

  if (ids1.size !== ids2.size) return false; // Different number of unique deps
  for (const id of ids1) {
    if (!ids2.has(id)) return false;
  }
  return true;
}

// Helper function to compare relatedFiles arrays (can be simple or complex)
function compareRelatedFiles(files1, files2) {
  const arr1 = files1 || [];
  const arr2 = files2 || [];

  if (arr1.length !== arr2.length) return false;

  // Simple comparison: check if paths and types are the same in the same order
  // For a more robust check, convert to Sets of strings like `path|type` or do deep object comparison
  for (let i = 0; i < arr1.length; i++) {
    if (arr1[i].path !== arr2[i].path || arr1[i].type !== arr2[i].type) {
      return false;
    }
    // Add more field comparisons if needed (description, lines, etc.)
    // if (arr1[i].description !== arr2[i].description) return false;
  }
  return true;
}

// Added: Function to show temporary error message
function showTemporaryError(message) {
  const errorElement = document.createElement("div");
  errorElement.className = "temporary-error";
  errorElement.textContent = message; // Keep message itself
  document.body.appendChild(errorElement);
  setTimeout(() => {
    errorElement.remove();
  }, 3000); // Show for 3 seconds
}

// Render task list - *** Needs further optimization to implement smart update ***
function renderTasks() {
  console.log("Rendering tasks..."); // Add log
  const filterValue = statusFilter.value;

  let filteredTasks = tasks;
  if (filterValue !== "all") {
    filteredTasks = filteredTasks.filter((task) => {
      if (!task.status) return false;
      const taskStatus = task.status.toLowerCase().replace(/ /g, "_");
      return taskStatus === filterValue;
    });
  }

  if (searchTerm) {
    const lowerCaseSearchTerm = searchTerm.toLowerCase();
    filteredTasks = filteredTasks.filter(
      (task) =>
        (task.name && task.name.toLowerCase().includes(lowerCaseSearchTerm)) ||
        (task.description &&
          task.description.toLowerCase().includes(lowerCaseSearchTerm))
    );
  }

  // Sort tasks
  filteredTasks.sort((a, b) => {
    switch (sortOption) {
      case "execution-order":
        // Fix: Use camelCase 'executionOrder' to match API response
        const orderA = (typeof a.executionOrder === 'number') ? a.executionOrder : Number.MAX_SAFE_INTEGER;
        const orderB = (typeof b.executionOrder === 'number') ? b.executionOrder : Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) return orderA - orderB;
        return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);

      case "name-asc":
        return (a.name || "").localeCompare(b.name || "");
      case "name-desc":
        return (b.name || "").localeCompare(a.name || "");
      case "status":
        const statusOrder = { pending: 1, in_progress: 2, completed: 3 };
        return (statusOrder[a.status] || 0) - (statusOrder[b.status] || 0);
      case "date-asc":
        return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
      case "date-desc":
      default:
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    }
  });

  // --- Simple brute force replacement (will cause flickering) ---
  // TODO: Implement DOM Diffing or more intelligent update strategy
  if (filteredTasks.length === 0) {
    taskListElement.innerHTML = `<div class="placeholder">${translate(
      "task_list_empty"
    )}</div>`;
  } else {
    // Only enable D&D if sorting by execution-order
    const isDraggable = sortOption === "execution-order";

    taskListElement.innerHTML = filteredTasks
      .map(
        (task) => {
          // Safe property access
          const tName = task.name || "Untitled Task";
          const tStatus = task.status || "pending";
          const tId = task.id || "";
          const tClientId = task.client_id;

          const client = clients.find(c => c.id === tClientId);
          const clientName = client ? client.name : (tClientId ? 'Unknown' : 'Local Host');
          const clientIcon = client ? getClientIcon(client.type) : '💻';

          const rowDragAttr = isDraggable ? 'draggable="true"' : '';
          // Drag handle HTML
          const dragHandleHtml = isDraggable ? '<div class="drag-handle" title="Drag to reorder">⋮⋮</div>' : '';

          // Normalize status for CSS class (lowercase, replace space/underscore with dash)
          const normalizeStatus = (s) => (s || 'pending').toLowerCase().replace(/[ _]/g, '-');
          const statusClass = normalizeStatus(tStatus);

          return `
            <div class="task-item status-${statusClass}" data-id="${tId}" onclick="selectTask('${tId}')" ${rowDragAttr}>
            <div class="task-item-content">
                ${dragHandleHtml}
                <div class="task-header">
                    <h3>${tName}</h3>
                </div>
            </div>
            <div class="task-meta">
                <span class="task-status status-${statusClass}">${tStatus}</span>
            </div>
            </div>
        `;
        }
      )
      .join("");

    // Attach drag events after render
    if (isDraggable) {
      const taskItems = taskListElement.querySelectorAll('.task-item');
      taskItems.forEach(item => {
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('drop', handleDrop);
        item.addEventListener('dragend', handleDragEnd);
      });
    }
  }
  // --- End simple brute force replacement ---

  // Re-apply selected state
  if (selectedTaskId) {
    const taskExists = tasks.some((t) => t.id === selectedTaskId);
    if (taskExists) {
      const selectedElement = document.querySelector(
        `.task-item[data-id="${selectedTaskId}"]`
      );
      if (selectedElement) {
        selectedElement.classList.add("selected");
      }
    } else {
      // If selected task no longer exists in new list, clear selection
      console.log(
        `Selected task ${selectedTaskId} no longer exists, clearing selection.`
      );
      selectedTaskId = null;
      taskDetailsContent.innerHTML = `<p class="placeholder">${translate(
        "task_details_placeholder"
      )}</p>`;
      highlightNode(null); // Clear graph highlight
    }
  }
}

// Select task
async function selectTask(taskId) {
  // Clear old selected state and highlight
  if (selectedTaskId) {
    const previousElement = document.querySelector(
      `.task-item[data-id="${selectedTaskId}"]`
    );
    if (previousElement) {
      previousElement.classList.remove("selected");
    }
  }

  // If clicked again on the same task, then clear selection
  if (selectedTaskId === taskId) {
    selectedTaskId = null;
    taskDetailsContent.innerHTML = `<p class="placeholder">${translate(
      "task_details_placeholder"
    )}</p>`;
    highlightNode(null); // Clear highlight
    hideTaskEditForm(); // Hide edit form when clearing selection
    return;
  }

  selectedTaskId = taskId;

  // Add new selected state
  const selectedElement = document.querySelector(
    `.task-item[data-id="${taskId}"]`
  );
  if (selectedElement) {
    selectedElement.classList.add("selected");
  }

  // Get and display task details
  const task = tasks.find((t) => t.id === taskId);

  if (!task) {
    taskDetailsContent.innerHTML = `<div class="placeholder">${translate(
      "error_task_not_found"
    )}</div>`;
    return;
  }

  // Fetch conversation history if detailed mode is enabled
  conversationHistory = await fetchConversationHistory(taskId);

  // --- Safely fill task details ---
  // 1. Create basic skeleton (use innerHTML, but replace dynamic content with ID'd empty elements)
  taskDetailsContent.innerHTML = `
    <div class="task-details-header">
      <h3 id="detail-name"></h3>
      <div class="task-meta">
        <span>Status: <span id="detail-status" class="task-status"></span></span>
      </div>
    </div>
    
    <!-- Added: Problem Statement -->
    <div class="task-details-section" id="detail-problem-statement-section" style="display: none;">
      <h4>Problem Statement</h4>
      <p id="detail-problem-statement"></p>
    </div>

    <!-- Added: Condition display Summary / Final Outcome -->
    <div class="task-details-section" id="detail-summary-section" style="display: none;">
      <h4>Completion Summary</h4>
      <p id="detail-summary"></p>
      <div id="detail-final-outcome-container" style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed #eee; display: none;">
        <strong>Final Outcome Content:</strong>
        <p id="detail-final-outcome"></p>
      </div>
    </div>
    
    <div class="task-details-section">
      <h4>Task Description</h4>
      <p id="detail-description"></p>
    </div>
    
    <!-- Added: Technical Plan -->
    <div class="task-details-section" id="detail-technical-plan-section" style="display: none;">
      <h4>Technical Plan</h4>
      <p id="detail-technical-plan"></p>
    </div>

    <div class="task-details-section">
      <h4>Implementation Guide</h4>
      <pre id="detail-implementation-guide"></pre>
    </div>
    
    <div class="task-details-section">
      <h4>Verification Criteria</h4>
      <p id="detail-verification-criteria"></p>
    </div>

    <!-- Added: Analysis Result -->
    <div class="task-details-section" id="detail-analysis-section" style="display: none;">
      <h4 data-i18n-key="task_detail_analysis_title">Analysis Result</h4>
      <pre id="detail-analysis" style="white-space: pre-wrap;"></pre>
    </div>

    <!-- Added: Lessons Learned -->
    <div class="task-details-section" id="detail-lessons-learned-section" style="display: none;">
      <h4>Lessons Learned</h4>
      <p id="detail-lessons-learned"></p>
    </div>
    
    <div class="task-details-section">
      <h4>Dependencies (Prerequisites)</h4>
      <div class="dependencies" id="detail-dependencies">
        <!-- Dependencies will be populated by JS -->
      </div>
    </div>
    
    <div class="task-details-section">
      <h4>Related Files</h4>
      <div class="related-files" id="detail-related-files">
        <!-- Related files will be populated by JS -->
      </div>
    </div>

    <div class="task-details-section">
      <h4>Notes</h4>
      <p id="detail-notes"></p>
    </div>
    
    <!-- Conversation history section will be added here if available -->
    <div id="conversation-history-container"></div>
  `;

  // 2. Get corresponding elements and use textContent safely to fill content
  const detailName = document.getElementById("detail-name");
  const detailStatus = document.getElementById("detail-status");
  const detailDescription = document.getElementById("detail-description");
  const detailImplementationGuide = document.getElementById(
    "detail-implementation-guide"
  );
  const detailVerificationCriteria = document.getElementById(
    "detail-verification-criteria"
  );
  // Added: Get Context Elements
  const detailProblemStatementSection = document.getElementById("detail-problem-statement-section");
  const detailProblemStatement = document.getElementById("detail-problem-statement");
  const detailTechnicalPlanSection = document.getElementById("detail-technical-plan-section");
  const detailTechnicalPlan = document.getElementById("detail-technical-plan");
  // Summary/Final Outcome
  const detailSummarySection = document.getElementById("detail-summary-section");
  const detailSummary = document.getElementById("detail-summary");
  const detailFinalOutcomeContainer = document.getElementById("detail-final-outcome-container");
  const detailFinalOutcome = document.getElementById("detail-final-outcome");
  // Lessons Learned
  const detailLessonsLearnedSection = document.getElementById("detail-lessons-learned-section");
  const detailLessonsLearned = document.getElementById("detail-lessons-learned");

  const detailNotes = document.getElementById("detail-notes");
  const detailDependencies = document.getElementById("detail-dependencies");
  const detailRelatedFiles = document.getElementById("detail-related-files");
  const conversationHistoryContainer = document.getElementById("conversation-history-container");

  const detailAnalysisSection = document.getElementById("detail-analysis-section");
  const detailAnalysis = document.getElementById("detail-analysis");

  if (detailName) detailName.textContent = task.name;
  if (detailStatus) {
    detailStatus.textContent = getStatusText(task.status);
    detailStatus.className = `task-status status-${task.status.replace(
      "_",
      "-"
    )}`;
  }

  // Problem Statement
  if (task.problemStatement && detailProblemStatementSection) {
    detailProblemStatement.textContent = task.problemStatement;
    detailProblemStatementSection.style.display = "block";
  } else if (detailProblemStatementSection) {
    detailProblemStatementSection.style.display = "none";
  }

  // Summary & Final Outcome
  if (detailSummarySection) {
    let showSummary = false;
    if (task.summary && detailSummary) {
      detailSummary.textContent = task.summary;
      showSummary = true;
    }

    if (task.finalOutcome && detailFinalOutcome && task.finalOutcome !== task.summary) {
      detailFinalOutcome.textContent = task.finalOutcome;
      detailFinalOutcomeContainer.style.display = "block";
      showSummary = true;
    } else if (detailFinalOutcomeContainer) {
      detailFinalOutcomeContainer.style.display = "none";
    }

    if (showSummary) {
      detailSummarySection.style.display = "block";
    } else {
      detailSummarySection.style.display = "none";
    }
  }

  if (detailDescription)
    detailDescription.textContent =
      task.description || translate("task_detail_no_description");

  // Technical Plan
  if (task.technicalPlan && detailTechnicalPlanSection) {
    detailTechnicalPlan.textContent = task.technicalPlan;
    detailTechnicalPlanSection.style.display = "block";
  } else if (detailTechnicalPlanSection) {
    detailTechnicalPlanSection.style.display = "none";
  }

  if (detailImplementationGuide)
    detailImplementationGuide.textContent =
      task.implementationGuide ||
      translate("task_detail_no_implementation_guide");
  if (detailVerificationCriteria)
    detailVerificationCriteria.textContent =
      task.verificationCriteria ||
      translate("task_detail_no_verification_criteria");

  // Analysis Result
  if (task.analysisResult && detailAnalysisSection) {
    detailAnalysis.textContent = task.analysisResult;
    detailAnalysisSection.style.display = "block";
  } else if (detailAnalysisSection) {
    detailAnalysisSection.style.display = "none";
  }

  // Lessons Learned
  if (task.lessonsLearned && detailLessonsLearnedSection) {
    detailLessonsLearned.textContent = task.lessonsLearned;
    detailLessonsLearnedSection.style.display = "block";
  } else if (detailLessonsLearnedSection) {
    detailLessonsLearnedSection.style.display = "none";
  }

  if (detailNotes)
    detailNotes.textContent = task.notes || translate("task_detail_no_notes");

  // 3. Dynamically generate dependencies and related files (these can include safe HTML structures like span)
  if (detailDependencies) {
    const dependenciesHtml =
      task.dependencies && task.dependencies.length
        ? task.dependencies
          .map((dep) => {
            const depId =
              typeof dep === "object" && dep !== null && dep.taskId
                ? dep.taskId
                : dep;
            const depTask = tasks.find((t) => t.id === depId);
            // Translate the fallback text for unknown dependency
            const depName = depTask
              ? depTask.name
              : `${translate("task_detail_unknown_dependency")}(${depId})`;
            const span = document.createElement("span");
            span.className = "dependency-tag";
            span.dataset.id = depId;
            span.textContent = depName;
            span.onclick = () => highlightNode(depId);
            return span.outerHTML;
          })
          .join("")
        : `<span class="placeholder">${translate(
          "task_detail_no_dependencies"
        )}</span>`; // Translate placeholder
    detailDependencies.innerHTML = dependenciesHtml;
  }

  if (detailRelatedFiles) {
    const relatedFilesHtml =
      task.relatedFiles && task.relatedFiles.length
        ? task.relatedFiles
          .map((file) => {
            const span = document.createElement("span");
            span.className = "file-tag";
            span.title = file.description || "";
            const pathText = document.createTextNode(`${file.path} `);
            const small = document.createElement("small");
            small.textContent = `(${file.type})`; // Type is likely technical, maybe no translation needed?
            span.appendChild(pathText);
            span.appendChild(small);
            return span.outerHTML;
          })
          .join("")
        : `<span class="placeholder">${translate(
          "task_detail_no_related_files"
        )}</span>`; // Translate placeholder
    detailRelatedFiles.innerHTML = relatedFilesHtml;
  }

  // Add conversation history section if available
  if (conversationHistoryContainer && conversationHistory && conversationHistory.length > 0) {
    conversationHistoryContainer.innerHTML = renderConversationHistory(conversationHistory);

    // Add event listeners for toggle buttons
    document.querySelectorAll(".toggle-btn").forEach((btn) => {
      const targetId = btn.getAttribute("data-target");
      const targetElement = document.getElementById(targetId);

      btn.addEventListener("click", () => {
        targetElement.classList.toggle("collapsed");
        btn.classList.toggle("collapsed");
      });
    });
  }

  // Just call highlight function
  highlightNode(taskId);

  // Show task edit form for the selected task
  showTaskEditForm(task);
}

// Render dependency relationship graph - Modified to global view and enter/update/exit mode
function renderDependencyGraph() {
  if (!dependencyGraphElement || !window.d3) {
    console.warn("D3 or dependency graph element not found.");
    if (dependencyGraphElement) {
      // First or D3 loss time display prompt, don't clear existing graph
      if (!dependencyGraphElement.querySelector("svg")) {
        dependencyGraphElement.innerHTML = `<p class="placeholder">${translate(
          "error_loading_graph_d3" // Use a specific key
        )}</p>`;
      }
    }
    return;
  }

  // If no tasks, clear graph and display prompt
  if (tasks.length === 0) {
    dependencyGraphElement.innerHTML = `<p class="placeholder">${translate(
      "dependency_graph_placeholder_empty"
    )}</p>`;
    // Reset SVG and simulation variables, so next time correctly initialize
    svg = null;
    g = null;
    simulation = null;
    return;
  }

  // 1. Prepare nodes (Nodes) and links (Links)
  const nodes = tasks.map((task) => ({
    id: task.id,
    name: task.name,
    status: task.status,
    executionOrder: task.executionOrder,
    // Keep existing position for smooth transition
    x: simulation?.nodes().find((n) => n.id === task.id)?.x,
    y: simulation?.nodes().find((n) => n.id === task.id)?.y,
    fx: simulation?.nodes().find((n) => n.id === task.id)?.fx, // Keep fixed position
    fy: simulation?.nodes().find((n) => n.id === task.id)?.fy,
  }));

  const links = [];
  tasks.forEach((task) => {
    if (task.dependencies && task.dependencies.length > 0) {
      task.dependencies.forEach((dep) => {
        const sourceId = typeof dep === "object" ? dep.taskId : dep;
        const targetId = task.id;
        if (
          nodes.some((n) => n.id === sourceId) &&
          nodes.some((n) => n.id === targetId)
        ) {
          // Ensure link's source/target is ID, for force directed recognition
          links.push({ source: sourceId, target: targetId });
        } else {
          console.warn(
            `Dependency link ignored: Task ${sourceId} or ${targetId} not found in task list.`
          );
        }
      });
    }
  });

  // 2. D3 drawing setup and update
  const width = dependencyGraphElement.clientWidth;
  const height = dependencyGraphElement.clientHeight || 400;

  if (!svg) {
    // --- First render ---
    console.log("First render of dependency graph");
    dependencyGraphElement.innerHTML = ""; // Clear placeholder

    svg = d3
      .select(dependencyGraphElement)
      .append("svg")
      .attr("viewBox", [0, 0, width, height])
      .attr("preserveAspectRatio", "xMidYMid meet");

    g = svg.append("g"); // Main group, for zooming and panning

    // Add zooming and panning
    svg.call(
      d3.zoom().on("zoom", (event) => {
        g.attr("transform", event.transform);
      })
    );

    // Add arrow definition
    g.append("defs")
      .append("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "-0 -5 10 10")
      .attr("refX", 25)
      .attr("refY", 0)
      .attr("orient", "auto")
      .attr("markerWidth", 8)
      .attr("markerHeight", 8)
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#999");

    // Initialize force directed simulation
    simulation = d3
      .forceSimulation() // Initialize without nodes
      .force(
        "link",
        d3
          .forceLink()
          .id((d) => d.id)
          .distance(100) // Specify id accessor
      )
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide().radius(30))
      .on("tick", ticked); // Bind tick event processing function

    // Add for storing links and nodes
    g.append("g").attr("class", "links");
    g.append("g").attr("class", "nodes");
  } else {
    // --- Update render ---
    console.log("Updating dependency graph");
    // Update SVG size and center force (if window size changes)
    svg.attr("viewBox", [0, 0, width, height]);
    simulation.force("center", d3.forceCenter(width / 2, height / 2));
  }

  // 3. Update links
  const linkSelection = g
    .select(".links") // Select g element for placing links
    .selectAll("line.link")
    .data(
      links,
      (d) => `${d.source.id || d.source}-${d.target.id || d.target}`
    ); // Key function based on source/target ID

  // Exit - Remove old links
  linkSelection
    .exit()
    .transition("exit")
    .duration(300)
    .attr("stroke-opacity", 0)
    .remove();

  // Enter - Add new links
  const linkEnter = linkSelection
    .enter()
    .append("line")
    .attr("class", "link")
    .attr("stroke", "#999")
    .attr("marker-end", "url(#arrowhead)")
    .attr("stroke-opacity", 0); // Initial transparent

  // Update + Enter - Update all link attributes (Merge enter and update selection)
  const linkUpdate = linkSelection.merge(linkEnter);

  linkUpdate
    .transition("update")
    .duration(500)
    .attr("stroke-opacity", 0.6)
    .attr("stroke-width", 1.5);

  // 4. Update nodes
  const nodeSelection = g
    .select(".nodes") // Select g element for placing nodes
    .selectAll("g.node-item")
    .data(nodes, (d) => d.id); // Use ID as key

  // Exit - Remove old nodes
  nodeSelection
    .exit()
    .transition("exit")
    .duration(300)
    .attr("transform", (d) => `translate(${d.x || 0}, ${d.y || 0}) scale(0)`) // Scale out from current position
    .attr("opacity", 0)
    .remove();

  // Enter - Add new node group
  const nodeEnter = nodeSelection
    .enter()
    .append("g")
    .attr("class", (d) => `node-item status-${getStatusClass(d.status)}`) // Use helper function to set class
    .attr("data-id", (d) => d.id)
    // Initial position: From simulated calculation position (if exists) or random position, initial scale 0
    .attr(
      "transform",
      (d) =>
        `translate(${d.x || Math.random() * width}, ${d.y || Math.random() * height
        }) scale(0)`
    )
    .attr("opacity", 0)
    .call(drag(simulation)); // Add drag

  // Add circle to Enter selection
  nodeEnter
    .append("circle")
    .attr("r", 14)
    .attr("stroke", "#fff")
    .attr("stroke-width", 2);
  // Color will be set through merge and update transition

  // Add execution order number inside the circle
  nodeEnter
    .append("text")
    .attr("class", "node-order")
    .attr("x", 0)
    .attr("y", 4)
    .attr("text-anchor", "middle")
    .attr("font-size", "11px")
    .attr("font-weight", "bold")
    .attr("fill", "#fff")
    .text((d) => typeof d.executionOrder === 'number' ? d.executionOrder : '?');

  // Add task name label to the side
  nodeEnter
    .append("text")
    .attr("class", "node-name")
    .attr("x", 20)
    .attr("y", 4)
    .text((d) => d.name)
    .attr("font-size", "10px")
    .attr("fill", "#ccc");

  // Add title (tooltip) to Enter selection
  nodeEnter
    .append("title")
    .text((d) => `${d.name} (${getStatusText(d.status)})`);

  // Add click event to Enter selection
  nodeEnter.on("click", (event, d) => {
    selectTask(d.id);
    event.stopPropagation();
  });

  // Update + Enter - Merge and update all nodes
  const nodeUpdate = nodeSelection.merge(nodeEnter);

  // Transition to final position and state
  nodeUpdate
    .transition("update")
    .duration(500)
    .attr("transform", (d) => `translate(${d.x || 0}, ${d.y || 0}) scale(1)`) // Move to simulated position and restore size
    .attr("opacity", 1);

  // Update node color (separate transition)
  nodeUpdate
    .select("circle")
    .transition("color")
    .duration(500)
    .attr("fill", getNodeColor); // Use existing getNodeColor function

  // Update node status Class (immediate update, no transition)
  nodeUpdate.attr(
    "class",
    (d) => `node-item status-${getStatusClass(d.status)}`
  );

  // << Added: Redefine drag function >>
  function drag(simulation) {
    function dragstarted(event, d) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event, d) {
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(event, d) {
      if (!event.active) simulation.alphaTarget(0);
      // Cancel fixed position, let node continue affected by force directed influence (if needed)
      // d.fx = null;
      // d.fy = null;
      // Or keep fixed position until next drag
    }

    return d3
      .drag()
      .on("start", dragstarted)
      .on("drag", dragged)
      .on("end", dragended);
  }
  // << drag function definition end >>

  // 5. Update force directed simulation
  simulation.nodes(nodes); // Update simulated nodes after enter/exit processing
  simulation.force("link").links(links); // Update simulated links
  simulation.alpha(0.3).restart(); // Reactivate simulation
}

// Tick function: Update node and link positions
function ticked() {
  if (!g) return;

  // Update link positions
  g.select(".links")
    .selectAll("line.link")
    .attr("x1", (d) => d.source.x)
    .attr("y1", (d) => d.source.y)
    .attr("x2", (d) => d.target.x)
    .attr("y2", (d) => d.target.y);

  // Update node group positions
  g.select(".nodes")
    .selectAll("g.node-item")
    // << Modified: Add coordinate fallback value >>
    .attr("transform", (d) => `translate(${d.x || 0}, ${d.y || 0})`);
}

// Function: Return color based on node data (example)
function getNodeColor(nodeData) {
  switch (nodeData.status) {
    case "Completed":
      return "var(--success)"; // Green
    case "In Progress":
      return "var(--warning)"; // Yellow
    case "Pending":
      return "var(--danger)"; // Red
    default:
      return "var(--text-tertiary)"; // Unknown status
  }
}

// Helper function
function getStatusText(status) {
  switch (status) {
    case "pending":
      return translate("status_pending");
    case "in_progress":
      return translate("status_in_progress");
    case "completed":
      return translate("status_completed");
    default:
      return status;
  }
}

function updateCurrentTime() {
  const now = new Date();
  // Keep original format, if time localization needed, can use translate or other library here
  const timeString = now.toLocaleString(); // Consider whether to base on currentLang format
  if (currentTimeElement) {
    // Separate static text and dynamic time
    const footerTextElement = currentTimeElement.parentNode.childNodes[0];
    if (footerTextElement && footerTextElement.nodeType === Node.TEXT_NODE) {
      footerTextElement.nodeValue = translate("footer_copyright");
    }
    currentTimeElement.textContent = timeString;
  }
}
// Update project progress indicator
function updateProgressIndicator() {
  const totalTasks = tasks.length;
  if (totalTasks === 0) {
    progressIndicator.style.display = "none"; // Hide if no tasks
    return;
  }

  progressIndicator.style.display = "block"; // Ensure display

  const completedTasks = tasks.filter(
    (task) => task.status === "Completed"
  ).length;
  const inProgressTasks = tasks.filter(
    (task) => task.status === "In Progress"
  ).length;
  const pendingTasks = tasks.filter((task) => task.status === "Pending").length;

  const completedPercent =
    totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;
  const inProgressPercent =
    totalTasks > 0 ? (inProgressTasks / totalTasks) * 100 : 0;
  const pendingPercent = totalTasks > 0 ? (pendingTasks / totalTasks) * 100 : 0;

  progressCompleted.style.width = `${completedPercent}%`;
  progressInProgress.style.width = `${inProgressPercent}%`;
  progressPending.style.width = `${pendingPercent}%`;

  // Update labels (using translate)
  progressLabels.innerHTML = `
    <span class="label-completed">${translate(
    "progress_completed"
  )}: ${completedTasks} (${completedPercent.toFixed(1)}%)</span>
    <span class="label-in-progress">${translate(
    "progress_in_progress"
  )}: ${inProgressTasks} (${inProgressPercent.toFixed(1)}%)</span>
    <span class="label-pending">${translate(
    "progress_pending"
  )}: ${pendingTasks} (${pendingPercent.toFixed(1)}%)</span>
    <span class="label-total">${translate(
    "progress_total"
  )}: ${totalTasks}</span>
  `;
}

// Added: Render global analysis result
// function renderGlobalAnalysisResult removed

// Added: Highlight dependency graph node
function highlightNode(taskId, status = null) {
  if (!g || !window.d3) return;

  // Clear all node highlights
  g.select(".nodes") // Start from g selection
    .selectAll("g.node-item")
    .classed("highlighted", false);

  if (!taskId) return;

  // Highlight selected node
  const selectedNode = g
    .select(".nodes") // Start from g selection
    .select(`g.node-item[data-id="${taskId}"]`);
  if (!selectedNode.empty()) {
    selectedNode.classed("highlighted", true);
    // Can optionally bring selected node to front
    // selectedNode.raise();
  }
}

// Added: Helper function to get status class (should be placed after ticked function, before getNodeColor or after)
function getStatusClass(status) {
  return status ? status.replace(/_/g, "-") : "unknown"; // Replace all underscores
}

// Function: Enable node drag (keep unchanged)
// ... drag ...

// Function to fetch conversation history for a task
async function fetchConversationHistory(taskId) {
  try {
    const response = await fetch(`/api/tasks/${taskId}/conversation`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const data = await response.json();
    return data.conversationHistory || [];
  } catch (error) {
    console.error("Error fetching conversation history:", error);
    return [];
  }
}

// Function to render conversation history in the task details
function renderConversationHistory(history) {
  if (!history || history.length === 0) {
    return '';
  }

  let historyHtml = `
    <div class="task-details-section conversation-history-section">
      <div class="section-header">
        <h4 data-i18n-key="conversation_history_title">Conversation History</h4>
        <button class="toggle-btn" data-target="conversation-content">${translate('toggle_conversation')}</button>
      </div>
      <div id="conversation-content" class="section-content conversation-content">
  `;

  // Sort messages by timestamp
  const sortedHistory = [...history].sort((a, b) =>
    new Date(a.timestamp) - new Date(b.timestamp)
  );

  sortedHistory.forEach(msg => {
    const timestamp = new Date(msg.timestamp).toLocaleString();
    const role = msg.role === 'user' ? translate('user_role') : translate('assistant_role');
    const toolInfo = msg.toolName ? `<span class="tool-name">${msg.toolName}</span>` : '';

    historyHtml += `
      <div class="message ${msg.role}-message">
        <div class="message-header">
          <span class="message-role">${role}</span>
          <span class="message-time">${timestamp}</span>
          ${toolInfo}
        </div>
        <div class="message-content">${msg.content}</div>
      </div>
    `;
  });

  historyHtml += `
      </div>
    </div>
  `;

  return historyHtml;
}
