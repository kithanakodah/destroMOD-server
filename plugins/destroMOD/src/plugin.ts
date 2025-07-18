import { BasePlugin } from "h1z1-server/out/servers/ZoneServer2016/managers/pluginmanager.js";
import { ZoneServer2016} from "h1z1-server/out/servers/ZoneServer2016/zoneserver.js";
import { ZoneClient2016 as Client } from "h1z1-server/out/servers/ZoneServer2016/classes/zoneclient";
// import { PermissionLevels } from "h1z1-server/out/servers/ZoneServer2016/commands/types";

export default class ServerPlugin extends BasePlugin {
  public name = "destroMOD";
  public description = "destroMOD loaded, check for differences";
  public author = "by Kithana";
  public version = "0.1 ALPHA";
  public commands = [
    // examples of how to add a custom command COMMENTED ALL THE BELOW OUT FOR NOW
   // {
   //   name: "testcommand",
   //   description: "This is an example of how to add a custom command.",
   //   permissionLevel: PermissionLevels.ADMIN, // determines what permission level a user needs to use this command
   //   execute: (server: ZoneServer2016, client: Client, args: Array<string>) => {
    //    // the code to executed when a command is trigged by an authorized user
    //    server.sendAlert(client, "Executed test command!");
  //    }
 //   },
 //   {
 //     name: "pluginhelp",
 //     description: "This is an example of how to list custom commands your plugin adds.",
 //    permissionLevel: PermissionLevels.DEFAULT, // determines what permission level a user needs to use this command
 //     execute: (server: ZoneServer2016, client: Client, args: Array<string>) => {
 //       // the code to executed when a command is trigged by an authorized user
  //      server.pluginManager.listCommands(server, client, this);
 //     }
 //   }
  ]

  private chatTextMessage!: string;

  /**
   * This method is called by PluginManager, do NOT call this manually
   * Use this method to set any plugin properties from the values in your config.yaml
  */ 
  public loadConfig(config: any) {
    this.chatTextMessage = config.chatTextMessage;
  }
  
  public async init(server: ZoneServer2016): Promise<void> {

    // an example of how to override the default behavior of any public ZoneServer2016 method
    server.pluginManager.hookMethod(this, server, "sendChatText", (client: Client, message: string, clearChat?: boolean)=> {
      server.sendAlert(client, this.chatTextMessage);
    }, {callBefore: false, callAfter: true})

    // an example of how to override the default behavior of any method outside of the ZoneServer2016 class (_packetHandlers in this example)
    server.pluginManager.hookMethod(this, server._packetHandlers, "ClientIsReady", (server: ZoneServer2016, client: Client, packet: any)=> {
      console.log(`Client ${client.character.characterId} is ready!`);
    }, {callBefore: false, callAfter: true})
  }
}