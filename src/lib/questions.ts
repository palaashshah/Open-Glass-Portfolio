// Display text for the backend-driven risk questionnaire.
// The backend (GET /questionnaire/meta) owns the id/options/group of each
// question. This file supplies the human-readable text and a short sidebar
// label per question, looked up by id. If the server returns a qid not
// listed here, the UI falls back to "Question {id}" / "Option {n}".

export type Question = {
    id: number
    sidebarLabel: string
    question: string
    options: { label: string }[]
}

export const questions: Question[] = [
    {
        id: 4,
        sidebarLabel: "Investment horizon",
        question: "How many years until you plan on withdrawing regular income or a lump sum from this account?",
        options: [
            { label: "0 – 4 years" },
            { label: "5 – 10 years" },
            { label: "11 – 20 years" },
        ],
    },
    {
        id: 5,
        sidebarLabel: "Primary goal",
        question: "What is your primary financial objective?",
        options: [
            { label: "Preserving capital and generating steady income" },
            { label: "A balance of income and moderate growth" },
            { label: "Maximum long-term capital growth" },
        ],
    },
    {
        id: 6,
        sidebarLabel: "Market reaction",
        question: "If the stock market were to suffer a sudden decline of 20% over a 3-month period, what are you most likely to do with your account?",
        options: [
            { label: "Sell all of my stock investments and move into safe cash / fixed income" },
            { label: "Sell some of my stocks to reduce risk" },
            { label: "Do nothing and wait for recovery" },
            { label: "Move more of my cash into stocks to buy at a lower price" },
        ],
    },
    {
        id: 7,
        sidebarLabel: "Fear factor",
        question: "Which of the following events do you fear the most regarding your investments?",
        options: [
            { label: "A loss of 10% of my principal value over a short period (6 months or less)" },
            { label: "Consistently underperforming broad market benchmarks" },
            { label: "Missing out on an opportunity that would have yielded substantially higher long-term returns, despite having higher risk" },
        ],
    },
    {
        id: 8,
        sidebarLabel: "Risk vs reward",
        question: "How much short-term investment risk are you willing to take in order to achieve larger long-term investment returns?",
        options: [
            { label: "I am not willing to take any risk" },
            { label: "I am willing to take a small amount of risk" },
            { label: "I am willing to take a moderate amount of risk" },
            { label: "I am willing to take as much risk as needed for maximum returns" },
        ],
    },
    {
        id: 9,
        sidebarLabel: "Market knowledge",
        question: "What is your overall knowledge and experience with financial markets?",
        options: [
            { label: "None / very little experience" },
            { label: "Moderate / some investment experience" },
            { label: "High / extensive experience" },
        ],
    },
    {
        id: 10,
        sidebarLabel: "Acceptable loss",
        question: "What is the maximum loss in any one-year period you would accept before changing your investments?",
        options: [
            { label: "Less than 5%" },
            { label: "5% – 10%" },
            { label: "11% – 20%" },
            { label: "More than 20%" },
        ],
    },
    {
        id: 11,
        sidebarLabel: "Return expectations",
        question: "What is your average annual return expectation from this investment?",
        options: [
            { label: "0% – 3% (capital preservation)" },
            { label: "3% – 5% (steady income)" },
            { label: "5% – 7% (moderate growth)" },
            { label: "More than 7% (aggressive growth)" },
        ],
    },
    {
        id: 12,
        sidebarLabel: "Investment approach",
        question: "Which best describes your overall investment approach?",
        options: [
            { label: "Prefers relative stability, minimal fluctuation" },
            { label: "Prefers some growth, accepts occasional small losses" },
            { label: "Prefers strong growth, accepts moderate losses" },
            { label: "Prefers maximum returns, accepts significant losses" },
        ],
    },
    {
        id: 13,
        sidebarLabel: "Emergency fund",
        question: "Do you have an emergency fund (savings of at least three months’ after-tax income)?",
        options: [
            { label: "I do not have an emergency fund" },
            { label: "Yes, but less than 3 months" },
            { label: "Yes, about 3 months" },
            { label: "Yes, about 6 months" },
            { label: "Yes, more than 6 months" },
        ],
    },
]
