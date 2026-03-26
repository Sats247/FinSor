import os
from dotenv import load_dotenv
load_dotenv()

from google import genai

api_key = os.getenv("GEMINI_API_KEY")
print(f"API Key loaded: {'YES — ' + api_key[:8] + '...' if api_key else 'NO — THIS IS YOUR PROBLEM'}")

client = genai.Client(api_key=api_key)

try:
    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents="Say hello in one sentence.",
    )
    print("SUCCESS:", response.text)
except Exception as e:
    print(f"FAILED: {type(e).__name__}: {e}")
