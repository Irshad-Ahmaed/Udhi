UDHI TECHNOLOGIES

# Home Assignment: Science Diagram Maker

## Overview

You will build a small web app that asks an AI model to draw 5 animated science diagrams, checks each diagram with code, and lets a reviewer approve or reject it. It should take about 4 hours. You have 24 hours from the time you get this document.

This is a small version of real work at Udhi Technologies. We make AI-generated lesson videos for UK GCSE students. We want to see how you deal with AI output that is sometimes wrong, slow or expensive.

## Part A: Make the diagrams (AI)

Write code that takes each of the 5 concepts at the end of this document and asks an AI model for one animated SVG diagram. An SVG is a picture made from code. The animation can be CSS or SMIL.

Your code must:

1. Call the model once per concept and get back an SVG.
2. Check every SVG in code before accepting it. Do at least these 4 checks:
   - The SVG is valid and can be parsed.
   - Nothing is drawn outside the viewBox.
   - It has a title and at least 3 text labels.
   - It has at least one animation.
3. Add 1 check of your own.
4. If a check fails, retry once and tell the model why it failed.
5. Handle API errors. On a 429 or 503 error, wait and try again, up to 3 times.
6. Log, for each concept: model name, input tokens, output tokens, estimated cost in USD, number of retries, and which checks passed or failed.
7. Save the 5 final results to a `results.json` file in your repo.

## Part B: Show them on a web page

Build one web page and put it on the internet. Use any stack you like. The page needs:

- A table with 5 rows, one per concept. Each row shows the diagram (animated), pass or fail for each check, the cost, and the number of retries.
- Approve and Reject buttons on every row, with a note box. The choice must still be there after a page refresh. You can save it in a database, a file on the server, or the browser. Say which one you chose, and why, in the README.
- A Generate button that runs Part A live for one concept, so we can test it. If the API fails, show a clear error message, not a blank page.
- The 5 saved results must already show when the page opens, without any API call.

## Rules

- **Model:** use a free Gemini model. We suggest `gemini-3.5-flash-lite` (the best free limits) or `gemini-3.5-flash`. Older 2.5 models are not available to new accounts.
- **API key:** get a free key at [aistudio.google.com/api-keys](https://aistudio.google.com/api-keys). You do not need a credit card. Free limits are low, so wait and retry on errors. If your key does not work, use another free model and tell us in the README.
- **Keep your key secret.** Never put it in your code or on GitHub. Set it as an environment variable on your host. A visible key means we reject the submission.
- **Deploy for free.** Use Vercel, Render, Streamlit Community Cloud, Hugging Face Spaces, or similar. We must be able to open one link, with no install.
- **AI tools are allowed** (ChatGPT, Claude, Copilot and so on). But you must be able to explain every line of your code on the call. We will ask you to make one change live.
- **Work alone**, and commit to Git often. We read your commit history.

## What to submit

Submit these in this [Google Form](https://docs.google.com/forms/d/e/1FAIpQLSd9truWPHIffJReJhJRRtG0L1O_VpjUrZ7fA5POonsFrOyPzA/viewform), within 24 hours:

1. The link to your live app.
2. The link to your GitHub repo (public, or shared with us).
3. A `README.md` in the repo with:
   - How to run it on your computer.
   - A results table: concept, pass or fail, cost, retries.
   - What failed, and how you fixed it.
   - What you would do with one more day.
   - Which AI tools you used, and for what.

Form link:
https://docs.google.com/forms/d/e/1FAIpQLSd9truWPHIffJReJhJRRtG0L1O_VpjUrZ7fA5POonsFrOyPzA/viewform

## How we review

We score out of 20, then talk to the best candidates on a short call. On the call you walk us through your code and make one small change live.

| What we check | Points |
| --- | --- |
| Link works and the table loads with 5 diagrams | 5 |
| Diagrams look right and animate | 4 |
| Real code checks, with retry | 4 |
| Cost and retries are logged and shown | 2 |
| Approve and Reject are saved | 2 |
| Honest README | 3 |

We reject a submission straight away if the link is dead, if your API key is visible in the code, or if you cannot explain your own code.

## About the internship

| | |
| --- | --- |
| Work | Remote |
| Stipend | ₹10,000 per month |
| Duration | 3 months |
| After that | Possible conversion to a full-time role, based on your performance |

## The 5 concepts

Give the model the text in the last column. Make one diagram per concept.

| # | Concept | Subject | Text for the model |
| --- | --- | --- | --- |
| 1 | Pythagoras' theorem | Maths | In a right-angled triangle, the longest side is called the hypotenuse. The square of the hypotenuse is equal to the sum of the squares of the other two sides: a² + b² = c². |
| 2 | Parts of a circle | Maths | A circle has a centre. The radius is the distance from the centre to the edge. The diameter goes across the circle through the centre and is twice the radius. The circumference is the distance around the circle. |
| 3 | Series circuit | Physics | In a series circuit there is only one loop. The current is the same everywhere in the loop. The voltage of the cell is shared between the components. |
| 4 | Photosynthesis | Biology | Plants take in carbon dioxide and water. They use light energy, absorbed by chlorophyll, to make glucose and oxygen. |
| 5 | States of matter | Chemistry | In a solid the particles are close together and vibrate in place. In a liquid they are close but move past each other. In a gas they are far apart and move fast. |
