import type { FileFormat, FileData, FormatHandler, ConvertPathNode } from "./FormatHandler.js";
import normalizeMimeType from "./normalizeMimeType.js";
import handlers from "./handlers";
import { TraversionGraph } from "./TraversionGraph.js";

declare const TomSelect: any;

/** Files currently selected for conversion */
let selectedFiles: File[] = [];
/**
 * Whether to use "simple" mode.
 * - In **simple** mode, the input/output lists are grouped by file format.
 * - In **advanced** mode, these lists are grouped by format handlers, which
 *   requires the user to manually select the tool that processes the output.
 */
let simpleMode: boolean = true;

const ui = {
  fileInput: document.querySelector("#file-input") as HTMLInputElement,
  fileSelectArea: document.querySelector("#file-area") as HTMLDivElement,
  convertButton: document.querySelector("#convert-button") as HTMLButtonElement,
  modeToggleButton: document.querySelector("#mode-button") as HTMLButtonElement,
  inputSelect: document.querySelector("#select-from") as HTMLSelectElement,
  outputSelect: document.querySelector("#select-to") as HTMLSelectElement,
  popupBox: document.querySelector("#popup") as HTMLDivElement,
  popupBackground: document.querySelector("#popup-bg") as HTMLDivElement
};

let inputTomSelect: any = null;
let outputTomSelect: any = null;

const checkSelections = () => {
  if (ui.inputSelect.value && ui.outputSelect.value) {
    ui.convertButton.className = "";
  } else {
    ui.convertButton.className = "disabled";
  }
};

// Map clicks in the file selection area to the file input element
ui.fileSelectArea.onclick = () => {
  ui.fileInput.click();
};

/**
 * Validates and stores user selected files. Works for both manual
 * selection and file drag-and-drop.
 * @param event Either a file input element's "change" event,
 * or a "drop" event.
 */
const fileSelectHandler = (event: Event) => {

  let inputFiles;

  if (event instanceof DragEvent) {
    inputFiles = event.dataTransfer?.files;
    if (inputFiles) event.preventDefault();
  } else if (event instanceof ClipboardEvent) {
    inputFiles = event.clipboardData?.files;
  } else {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    inputFiles = target.files;
  }

  if (!inputFiles) return;
  const files = Array.from(inputFiles);
  if (files.length === 0) return;

  if (files.some(c => c.type !== files[0].type)) {
    return alert("All input files must be of the same type.");
  }
  files.sort((a, b) => a.name === b.name ? 0 : (a.name < b.name ? -1 : 1));
  selectedFiles = files;

  const fileAreaContent = ui.fileSelectArea.querySelector('.file-area-content');
  if (fileAreaContent) {
    fileAreaContent.innerHTML = `<h2>
      ${files[0].name}
      ${files.length > 1 ? `<br>... and ${files.length - 1} more` : ""}
    </h2>`;
  }

  // Common MIME type adjustments (to match "mime" library)
  let mimeType = normalizeMimeType(files[0].type);

  const fileExtension = files[0].name.split(".").pop()?.toLowerCase();

  // Find all options matching the input MIME type.
  const optionsMatchingMime = Array.from(ui.inputSelect.options).filter(opt => {
    if (!opt.value) return false;
    const format = allOptions[parseInt(opt.value)];
    return format?.format.mime === mimeType;
  });
  
  // If there are multiple, find one with a matching extension too
  let inputFormatOption: HTMLOptionElement | undefined;
  if (optionsMatchingMime.length > 1) {
    inputFormatOption = optionsMatchingMime.find(opt => {
      const format = allOptions[parseInt(opt.value)];
      return format.format.extension === fileExtension;
    }) || optionsMatchingMime[0] as HTMLOptionElement;
  } else if (optionsMatchingMime.length === 1) {
    inputFormatOption = optionsMatchingMime[0] as HTMLOptionElement;
  }

  if (inputFormatOption && inputTomSelect) {
    inputTomSelect.setValue(inputFormatOption.value);
    return;
  }

  // Fall back to matching format by file extension if MIME type wasn't found.
  const optionExtension = Array.from(ui.inputSelect.options).find(opt => {
    if (!opt.value) return false;
    const format = allOptions[parseInt(opt.value)];
    return format?.format.extension.toLowerCase() === fileExtension;
  }) as HTMLOptionElement;
  
  if (optionExtension && inputTomSelect) {
    inputTomSelect.setValue(optionExtension.value);
  }

};

// Add the file selection handler to both the file input element and to
// the window as a drag-and-drop event, and to the clipboard paste event.
ui.fileInput.addEventListener("change", fileSelectHandler);
window.addEventListener("drop", fileSelectHandler);
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("paste", fileSelectHandler);

/**
 * Display an on-screen popup.
 * @param html HTML content of the popup box.
 */
window.showPopup = function (html: string) {
  ui.popupBox.innerHTML = html;
  ui.popupBox.classList.add('active');
  ui.popupBackground.classList.add('active');
}
/**
 * Hide the on-screen popup.
 */
window.hidePopup = function () {
  ui.popupBox.classList.remove('active');
  ui.popupBackground.classList.remove('active');
}

const allOptions: Array<{ format: FileFormat, handler: FormatHandler }> = [];

window.supportedFormatCache = new Map();
window.traversionGraph = new TraversionGraph();

window.printSupportedFormatCache = () => {
  const entries = [];
  for (const entry of window.supportedFormatCache) {
    entries.push(entry);
  }
  return JSON.stringify(entries, null, 2);
}


async function buildOptionList () {

  allOptions.length = 0;
  
  if (inputTomSelect) {
    inputTomSelect.destroy();
    inputTomSelect = null;
  }
  if (outputTomSelect) {
    outputTomSelect.destroy();
    outputTomSelect = null;
  }
  
  ui.inputSelect.innerHTML = "<option value=''>Select format...</option>";
  ui.outputSelect.innerHTML = "<option value=''>Select format...</option>";

  for (const handler of handlers) {
    if (!window.supportedFormatCache.has(handler.name)) {
      console.warn(`Cache miss for formats of handler "${handler.name}".`);
      try {
        await handler.init();
      } catch (_) { continue; }
      if (handler.supportedFormats) {
        window.supportedFormatCache.set(handler.name, handler.supportedFormats);
        console.info(`Updated supported format cache for "${handler.name}".`);
      }
    }
    const supportedFormats = window.supportedFormatCache.get(handler.name);
    if (!supportedFormats) {
      console.warn(`Handler "${handler.name}" doesn't support any formats.`);
      continue;
    }
    for (const format of supportedFormats) {

      if (!format.mime) continue;

      allOptions.push({ format, handler });

      // In simple mode, display each input/output format only once
      let addToInputs = true, addToOutputs = true;
      if (simpleMode) {
        addToInputs = !Array.from(ui.inputSelect.options).some(c => {
          if (!c.value) return false;
          const currFormat = allOptions[parseInt(c.value)]?.format;
          return currFormat?.mime === format.mime && currFormat?.format === format.format;
        });
        addToOutputs = !Array.from(ui.outputSelect.options).some(c => {
          if (!c.value) return false;
          const currFormat = allOptions[parseInt(c.value)]?.format;
          return currFormat?.mime === format.mime && currFormat?.format === format.format;
        });
        if ((!format.from || !addToInputs) && (!format.to || !addToOutputs)) continue;
      }

      const newOption = document.createElement("option");
      newOption.value = (allOptions.length - 1).toString();

      const formatDescriptor = format.format.toUpperCase();
      if (simpleMode) {
        // Hide any handler-specific information in simple mode
        const cleanName = format.name
          .split("(").join(")").split(")")
          .filter((_, i) => i % 2 === 0)
          .filter(c => c != "")
          .join(" ");
        newOption.textContent = `${formatDescriptor} - ${cleanName} (${format.mime})`;
      } else {
        newOption.textContent = `${formatDescriptor} - ${format.name} (${format.mime}) ${handler.name}`;
      }

      if (format.from && addToInputs) {
        ui.inputSelect.appendChild(newOption.cloneNode(true));
      }
      if (format.to && addToOutputs) {
        ui.outputSelect.appendChild(newOption.cloneNode(true));
      }

    }
  }
  window.traversionGraph.init(window.supportedFormatCache, handlers);
  
  const tsConfig = {
    sortField: { field: "text", direction: "asc" },
    onChange: checkSelections
  };
  
  inputTomSelect = new TomSelect(ui.inputSelect, tsConfig);
  outputTomSelect = new TomSelect(ui.outputSelect, tsConfig);

  document.getElementById('loading-from')?.classList.add('hidden');
  document.getElementById('loading-to')?.classList.add('hidden');
  document.getElementById('wrapper-from')?.classList.remove('hidden');
  document.getElementById('wrapper-to')?.classList.remove('hidden');

  window.hidePopup();

}

(async () => {
  try {
    const cacheJSON = await fetch("cache.json").then(r => r.json());
    window.supportedFormatCache = new Map(cacheJSON);
  } catch {
    console.warn(
      "Missing supported format precache.\n\n" +
      "Consider saving the output of printSupportedFormatCache() to cache.json."
    );
  } finally {
    await buildOptionList();
    console.log("Built initial format list.");
  }
})();

ui.modeToggleButton.addEventListener("click", () => {
  simpleMode = !simpleMode;
  if (simpleMode) {
    ui.modeToggleButton.textContent = "Advanced mode";
  } else {
    ui.modeToggleButton.textContent = "Simple mode";
  }
  buildOptionList();
});

let deadEndAttempts: ConvertPathNode[][];

async function attemptConvertPath (files: FileData[], path: ConvertPathNode[]) {

  const pathString = path.map(c => c.format.format).join(" → ");

  // Exit early if we've encountered a known dead end
  for (const deadEnd of deadEndAttempts) {
    let isDeadEnd = true;
    for (let i = 0; i < deadEnd.length; i++) {
      if (path[i] === deadEnd[i]) continue;
      isDeadEnd = false;
      break;
    }
    if (isDeadEnd) {
      const deadEndString = deadEnd.slice(-2).map(c => c.format.format).join(" → ");
      console.warn(`Skipping ${pathString} due to dead end near ${deadEndString}.`);
      return null;
    }
  }

  ui.popupBox.innerHTML = `<h2>Finding conversion route...</h2>
    <p>Trying <b>${pathString}</b>...</p>`;

  for (let i = 0; i < path.length - 1; i ++) {
    const handler = path[i + 1].handler;
    try {
      let supportedFormats = window.supportedFormatCache.get(handler.name);
      if (!handler.ready) {
        await handler.init();
        if (!handler.ready) throw `Handler "${handler.name}" not ready after init.`;
        if (handler.supportedFormats) {
          window.supportedFormatCache.set(handler.name, handler.supportedFormats);
          supportedFormats = handler.supportedFormats;
        }
      }
      if (!supportedFormats) throw `Handler "${handler.name}" doesn't support any formats.`;
      const inputFormat = supportedFormats.find(c =>
        c.from
        && c.mime === path[i].format.mime
        && c.format === path[i].format.format
      ) || (handler.supportAnyInput ? path[i].format : undefined);
      if (!inputFormat) throw `Handler "${handler.name}" doesn't support the "${path[i].format.format}" format.`;
      files = (await Promise.all([
        handler.doConvert(files, inputFormat, path[i + 1].format),
        // Ensure that we wait long enough for the UI to update
        new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      ]))[0];
      if (files.some(c => !c.bytes.length)) throw "Output is empty.";
    } catch (e) {

      console.log(path.map(c => c.format.format));
      console.error(handler.name, `${path[i].format.format} → ${path[i + 1].format.format}`, e);

      // Dead ends are added both to the graph and to the attempt system.
      // The graph may still have old paths queued from before they were
      // marked as dead ends, so we catch that here.
      const deadEndPath = path.slice(0, i + 2);
      deadEndAttempts.push(deadEndPath);
      window.traversionGraph.addDeadEndPath(path.slice(0, i + 2));

      ui.popupBox.innerHTML = `<h2>Finding conversion route...</h2>
        <p>Looking for a valid path...</p>`;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      return null;

    }
  }

  return { files, path };

}

window.tryConvertByTraversing = async function (
  files: FileData[],
  from: ConvertPathNode,
  to: ConvertPathNode
) {
  deadEndAttempts = [];
  window.traversionGraph.clearDeadEndPaths();
  for await (const path of window.traversionGraph.searchPath(from, to, simpleMode)) {
    // Use exact output format if the target handler supports it
    if (path.at(-1)?.handler === to.handler) {
      path[path.length - 1] = to;
    }
    const attempt = await attemptConvertPath(files, path);
    if (attempt) return attempt;
  }
  return null;
}

function downloadFile (bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/octet-stream" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
}

ui.convertButton.onclick = async function () {

  const inputFiles = selectedFiles;

  if (inputFiles.length === 0) {
    return alert("Select an input file.");
  }

  if (!ui.inputSelect.value) return alert("Specify input file format.");
  if (!ui.outputSelect.value) return alert("Specify output file format.");

  const inputOption = allOptions[Number(ui.inputSelect.value)];
  const outputOption = allOptions[Number(ui.outputSelect.value)];

  const inputFormat = inputOption.format;
  const outputFormat = outputOption.format;

  try {

    const inputFileData = [];
    for (const inputFile of inputFiles) {
      const inputBuffer = await inputFile.arrayBuffer();
      const inputBytes = new Uint8Array(inputBuffer);
      if (
        inputFormat.mime === outputFormat.mime
        && inputFormat.format === outputFormat.format
      ) {
        downloadFile(inputBytes, inputFile.name);
        continue;
      }
      inputFileData.push({ name: inputFile.name, bytes: inputBytes });
    }

    window.showPopup("<h2>Finding conversion route...</h2>");
    // Delay for a bit to give the browser time to render
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const output = await window.tryConvertByTraversing(inputFileData, inputOption, outputOption);
    if (!output) {
      window.hidePopup();
      alert("Failed to find conversion route.");
      return;
    }

    for (const file of output.files) {
      downloadFile(file.bytes, file.name);
    }

    window.showPopup(
      `<h2>Converted ${inputOption.format.format} to ${outputOption.format.format}!</h2>` +
      `<p>Path used: <b>${output.path.map(c => c.format.format).join(" → ")}</b>.</p>\n` +
      `<button onclick="window.hidePopup()">OK</button>`
    );

  } catch (e) {

    window.hidePopup();
    alert("Unexpected error while routing:\n" + e);
    console.error(e);

  }

};

// Display the current git commit SHA in the UI, if available
{
  const commitElement = document.querySelector("#commit-id");
  if (commitElement) {
    commitElement.textContent = import.meta.env.VITE_COMMIT_SHA ?? "unknown";
  }
}
