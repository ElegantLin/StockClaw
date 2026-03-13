import { renderControlPanelClientScript } from "./ui/client-script.js";
import { renderControlPanelShell } from "./ui/shell.js";
import { CONTROL_PANEL_STYLES } from "./ui/styles.js";

export function renderControlPanelHtml(): string {
  const bootPayload = JSON.stringify(
    {
      apiBase: "/api",
      defaults: {
        userId: "web-user",
        sessionId: "",
      },
    },
    null,
    2,
  )
    .replaceAll("</script>", "<\\/script>")
    .replaceAll("<", "\\u003c");

  return renderControlPanelShell(
    bootPayload,
    CONTROL_PANEL_STYLES,
    renderControlPanelClientScript(),
  );
}
