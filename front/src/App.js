import React, { useState } from "react";
import "./App.css";

const apiUrl = process.env.REACT_APP_API_URL;

function App() {
  const [text1, setText1] = useState("");
  const [text2, setText2] = useState("");
  const [loading, setLoading] = useState(false);



  const handleClick = async () => {
    setText1("");
    setText2("");
    setLoading(true);
    try {
      const response = await fetch(`${apiUrl}/fitness`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      const data = await response.json();
      setText1(data.action || "");
      setText2(data.randomAmount || "");
    } catch (e) {
      console.error("Ошибка при получении данных:", e);
      setText1("Ошибка!");
      setText2("Ошибка! Найдите форму обратной связи в боте!");
    }
    setLoading(false);
  };

  return (
    <div className="app-root">
      <div className="app-card">
        <h2 className="app-title">Random Fitness Mini App</h2>
        <div className="app-text-block">{text1}</div>
        <div className="app-text-block">{text2}</div>
        <button
          className="app-button"
          onClick={handleClick}
          disabled={loading}
        >
          {loading ? "Загрузка..." : "Получить"}
        </button>
      </div>
    </div>
  );
}

export default App;
