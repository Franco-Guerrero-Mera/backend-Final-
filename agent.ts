import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { StateGraph } from "@langchain/langgraph";
import { Annotation } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { MongoClient } from "mongodb";
import { z } from "zod";
import "dotenv/config";

// 🆕 Tavily Web Search import
import { TavilySearchResults } from "@langchain/community/tools/tavily_search";

export async function callAgent(
  client: MongoClient,
  query: string,
  thread_id: string
) {
  try {
    const dbName = "rag_d2";
    const db = client.db(dbName);

    const GraphState = Annotation.Root({
      messages: Annotation<BaseMessage[]>({
        reducer: (x, y) => x.concat(y),
      }),
    });

    // 🌐 Web Search Tool using Tavily
    const tavily = new TavilySearchResults({
      apiKey: process.env.TAVILY_API_KEY!,
    });

    const tools = [tavily];
    const toolNode = new ToolNode<typeof GraphState.State>(tools);

    const model = new ChatOpenAI({
      modelName: "gpt-4o-mini",
      temperature: 0,
    }).bindTools(tools);

    function shouldContinue(state: typeof GraphState.State) {
      const messages = state.messages;
      const lastMessage = messages[messages.length - 1] as AIMessage;

      const content =
        typeof lastMessage.content === "string" ? lastMessage.content : "";

      if (lastMessage.tool_calls?.length) {
        return "tools";
      }

      if (content.toUpperCase().startsWith("FINAL ANSWER")) {
        return "__end__";
      }

      return "__end__";
    }

    async function callModel(state: typeof GraphState.State) {
      const prompt = ChatPromptTemplate.fromMessages([
        [
          "system",
          `You are a helpful AI assistant who responds in Spanish. Use tools to make progress. 
If you can fully answer the user’s question, prefix your response with 'FINAL ANSWER:' and stop but dont say FINAL ANSWER.
Do not repeat tasks endlessly. Always Use the tools.
Available tools: {tool_names}.
{system_message}
Current time: {time}`,
        ],
        new MessagesPlaceholder("messages"),
      ]);

      const formattedPrompt = await prompt.formatMessages({
        system_message:
          "Eres un asistente útil experto en las reglas y regulaciones de LAUSD que responde en español. Siempre utiliza la herramienta de búsqueda web para obtener información actualizada. Siempre provee enlaces a la información que encuentres.",
        time: new Date().toISOString(),
        tool_names: tools.map((tool) => tool.name).join(", "),
        messages: state.messages,
      });

      const result = await model.invoke(formattedPrompt);
      return { messages: [result] };
      
    }

    const workflow = new StateGraph(GraphState)
      .addNode("agent", callModel)
      .addNode("tools", toolNode)
      .addEdge("__start__", "agent")
      .addConditionalEdges("agent", shouldContinue)
      .addEdge("tools", "agent");

    const checkpointer = new MongoDBSaver({ client, dbName });

    const app = workflow.compile({ checkpointer });

    const finalState = await app.invoke(
      {
        messages: [new HumanMessage(query)],
      },
      { recursionLimit: 15, configurable: { thread_id } }
    );

    const finalMessage = finalState.messages[finalState.messages.length - 1].content;

    console.log(finalMessage);
    return finalMessage;
  } catch (err) {
    console.error("Agent error:", err);
    return "Lamento que haya habido un error, ¿puedes intentar reformular su pregunta? Intenta simplificar la pregunta. Gracias."
    }
}
