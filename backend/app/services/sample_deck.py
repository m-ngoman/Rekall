"""The starter deck offered during onboarding.

Its job is to get someone to the moment that makes Rekall different — typing a real answer and
being told what they missed — without first asking them to photograph a notebook. An empty app
cannot demonstrate itself, and "upload something before you can see what this does" is where a
first run usually ends.

The cards are chosen for that demonstration specifically: each answer is a short phrase with
genuine synonyms and paraphrases, so free-text grading has something to actually judge. Questions
with one-word canonical answers ("What year...") would grade correctly but prove nothing, since a
string comparison would handle them too.
"""

SAMPLE_DECK_NAME = "Sample deck — how Rekall works"

SAMPLE_CARDS: list[dict[str, str]] = [
    {
        "subtopic": "The body",
        "question": "What produces most of a cell's ATP?",
        "answer": "The mitochondria, through oxidative phosphorylation.",
    },
    {
        "subtopic": "The body",
        "question": "What does insulin do to blood glucose?",
        "answer": "It lowers it, by moving glucose out of the blood and into cells.",
    },
    {
        "subtopic": "The body",
        "question": "Why do arteries have thicker walls than veins?",
        "answer": "They carry blood at much higher pressure, straight from the heart.",
    },
    {
        "subtopic": "Earth",
        "question": "What happens at a divergent plate boundary?",
        "answer": "Plates move apart and new crust forms in the gap.",
    },
    {
        "subtopic": "Earth",
        "question": "Why is the sky blue?",
        "answer": "Shorter blue wavelengths scatter more than longer ones in the atmosphere.",
    },
    {
        "subtopic": "Studying",
        "question": "What is the spacing effect?",
        "answer": "You remember more when reviews are spread out over time than crammed together.",
    },
]
