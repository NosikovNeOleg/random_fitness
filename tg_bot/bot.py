import os
import logging
from telegram import Update, KeyboardButton, ReplyKeyboardMarkup, WebAppInfo
from telegram.ext import Application, CommandHandler, ContextTypes

API_TOKEN = os.getenv("TG_API_TOKEN")
MINI_APP_URL = "https://nosikovneoleg.github.io/random_fitness/"

logging.basicConfig(level=logging.INFO)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    kb = [
        [KeyboardButton("Открыть приложение", web_app=WebAppInfo(url=MINI_APP_URL))]
    ]
    reply_markup = ReplyKeyboardMarkup(kb, resize_keyboard=True)
    await update.message.reply_text(
        "Нажмите кнопку ниже, чтобы открыть приложение:",
        reply_markup=reply_markup
    )

if __name__ == "__main__":
    app = Application.builder().token(API_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.run_polling()