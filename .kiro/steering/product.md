# Product: AI-agent programming tutor

> Working name: `tutor-agent` (final name TBD; candidates: CodIA, Pythia, Hintly).
> Full POC document: `stacky.md` at the repository root.

## Vision
A web application where a student learns beginner Python with a tutor agent.
The student sees the lesson, writes code in an editor, runs tests and chats with the tutor.
The project is also the base for a series of posts on AWS Builder Center (DevTools category).

## Pedagogical principles (mandatory)
- The tutor uses the Socratic method: it asks questions and guides, and does not hand over the solution directly.
- Hints are progressive, in 3 levels: (1) orientation, (2) structure, (3) almost the solution.
- The full solution is only given if the student asks for it after exhausting the hints, and with an explanation.
- The reference solution never leaves the server for the front end.
- Errors are explained in simple words and treated as a learning opportunity.
- If the student fails the same concept 3 times, the tutor changes analogy or lowers the difficulty.
- Short answers, with analogies and small examples. Patient and curious tone.

## MVP scope
- Language taught: Python, beginner level.
- Curriculum: 8 modules (first steps, operators and strings, conditionals, loops,
  lists and dictionaries, functions, files and errors, capstone mini project).
- UI and tutor language: Spanish.

## Out of scope
- Other languages, advanced OOP, certificates, gamification, payments, teacher dashboard, mobile app.

## POC success criteria
- The student completes a module end to end with the tutor.
- The tutor does not give the full solution before the hints are exhausted.
- The student's code runs in an isolated sandbox (AgentCore Code Interpreter).
- The agent remembers progress across sessions (AgentCore Memory).
- Everything is deployed with CDK.

## Phases (one spec per phase, one post per phase)
0. Base: Vite + React front end, TypeScript API with mock responses, minimal CDK.
1. Real tutor: Strands agent (Python) on AgentCore Runtime.
2. Code execution with AgentCore Code Interpreter.
3. Memory and progress with AgentCore Memory.
4. Content (Knowledge Base) and guardrails.
5. Production: Cognito login, observability, costs and `.dev` domain.

Every phase is done when it can be tested in the browser. Each phase ends with a git tag
(`fase-0`, `fase-1`, ...) and a post draft in `docs/posts/`.
