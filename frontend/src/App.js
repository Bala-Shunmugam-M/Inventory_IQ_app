import { useEffect } from "react";
import "@/App.css";

function App() {
  useEffect(() => {
    // Redirect root URL to the standalone InventoryIQ application
    window.location.replace("/InventoryIQ_v4.html");
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0B0F1A",
        color: "#E2E8F0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "-apple-system, system-ui, sans-serif",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            width: 40,
            height: 40,
            border: "3px solid #1E293B",
            borderTopColor: "#3B82F6",
            borderRadius: "50%",
            margin: "0 auto 16px",
            animation: "iq-spin 0.9s linear infinite",
          }}
        />
        <div style={{ fontSize: 15, fontWeight: 600 }}>Loading InventoryIQ…</div>
        <div style={{ fontSize: 12, color: "#64748B", marginTop: 6 }}>
          If you are not redirected,{" "}
          <a
            href="/InventoryIQ_v4.html"
            style={{ color: "#3B82F6", textDecoration: "none" }}
          >
            click here
          </a>
          .
        </div>
        <style>{`@keyframes iq-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}

export default App;
